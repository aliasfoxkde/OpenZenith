//! Clear-sky daily potential insolation on a horizontal surface.
//!
//! Accuracy class: **clear-sky potential, local-slope shading only.** Every
//! cell is treated as an untilted horizontal surface under a cloudless sky;
//! terrain enters only through a shading test that marches a bounded number
//! of cells along each sun position's azimuth and compares the highest
//! terrain angle found there with the sun's altitude. That is the same
//! cumulative-maximum-slope idea [`crate::viewshed`] uses, but bounded to a
//! few cells and one sample per cell step, so a ridge two valleys away does
//! not shade and a horizon sampled at whole-cell resolution is quantised.
//! Where shadow accuracy matters, run a full horizon-tracing viewshed per sun
//! position instead.
//!
//! # Solar position
//!
//! Standard clear-sky astronomy, in local solar time (the equation of time
//! and the UTC/longitude offset are deliberately not applied — results are
//! potentials for a given latitude and day, not for a clock schedule):
//!
//! * day angle `γ = 2π (day - 1) / 365` (365 is used in leap years too, as
//!   the NOAA Solar Calculator does)
//! * declination `δ` — Spencer's (1971) seven-term Fourier series, the series
//!   published with the NOAA Solar Calculator (`δ` in radians)
//! * Earth–Sun distance correction `E₀` — Spencer's (1971) four-term series
//! * hour angle `H = π (t - 12) / 12` for local solar time `t` in hours
//! * altitude `alt` from `sin alt = sin φ sin δ + cos φ cos δ cos H`
//! * azimuth from `cos az = (sin δ - sin alt sin φ) / (cos alt cos φ)`,
//!   mirrored to the afternoon when `H > 0`
//!
//! # Irradiance model
//!
//! With the solar constant `1367 W/m²`, a fixed clear-sky transmittance `τ`
//! and air mass `m = 1 / sin alt`:
//!
//! ```text
//! direct  = 1367 · E₀ · τ^m · sin alt          (W/m², horizontal)
//! diffuse = 0.3 · (1 - τ^m) · 1367 · E₀ · sin alt
//! ```
//!
//! The diffuse term is an isotropic-sky approximation: a fixed share of the
//! atmosphere's attenuation comes back as diffuse irradiance. The day is
//! integrated with the midpoint rule over the requested `interval_hours`
//! (clamped to `1..=MAX_INTEGRATION_STEPS` steps of `24/n` hours) and summed
//! into `kWh/m²/day`; nighttime steps contribute nothing and are not walked
//! for shading.

use ndarray::{Array2, ArrayView2};

/// Solar constant, in W/m² (World Radiation Center nominal value).
const SOLAR_CONSTANT: f64 = 1367.0;

/// Clear-sky direct-beam transmittance through one air mass (dimensionless).
///
/// A single sea-level value: elevation, aerosols, water vapour and turbidity
/// are out of scope for a *potential* insolation estimate.
const TRANSMITTANCE: f64 = 0.75;

/// Share of the atmosphere's attenuation returned as isotropic diffuse
/// irradiance (dimensionless).
const DIFFUSE_FRACTION: f64 = 0.3;

/// Insolation integration interval used when a caller supplies a
/// non-positive or non-finite one, in hours.
const DEFAULT_INTERVAL_HOURS: f64 = 0.5;

/// Shading march length used when a caller leaves it unset, in cells.
pub const DEFAULT_HORIZON_CELLS: usize = 10;

/// Upper bound on the number of integration steps per day.
///
/// Keeps a pathologically small `interval_hours` (or a non-finite one that
/// survives the guard) from turning into millions of sun positions: the step
/// count is clamped to this and the step width follows as
/// `24 / MAX_INTEGRATION_STEPS`.
const MAX_INTEGRATION_STEPS: usize = 480;

/// Seconds in an hour, spelled out because the integration mixes hours and
/// watt-hours.
const SECONDS_PER_HOUR: f64 = 3600.0;

/// `cos alt` below which the sun counts as overhead and the azimuth as
/// undefined, in radians of altitude from the zenith.
///
/// `asin` rounds anything within about 1.5e-8 rad of the zenith to the same
/// neighbourhood, so a cutoff tighter than that could never be reached by
/// [`solar_altitude_rad`]'s output; 1e-7 rad is still 4e-4 degrees of sun
/// position.
const ZENITH_COS_ALTITUDE: f64 = 1e-7;

/// Solar position and shading parameters for [`solar_insolation`].
#[derive(Debug, Clone, Copy)]
pub struct SolarConfig {
    /// Latitude of the grid, in degrees; values outside ±90 are clamped.
    pub latitude_deg: f64,
    /// Day of year, 1–366; values outside that range are clamped.
    pub day_of_year: u32,
    /// Integration step of the daily sum, in hours; the default is 0.5 h and
    /// any non-positive or non-finite value falls back to it.
    pub interval_hours: f64,
    /// Ground size of one cell, in the same unit as the elevations (metres
    /// for a projected DEM). A non-positive value disables shading.
    pub cell_size: f32,
    /// How many cells the shading check marches along the sun's azimuth; the
    /// default is [`DEFAULT_HORIZON_CELLS`], and 0 disables shading entirely.
    pub horizon_cells: usize,
}

impl Default for SolarConfig {
    fn default() -> Self {
        Self {
            latitude_deg: 0.0,
            day_of_year: 1,
            interval_hours: DEFAULT_INTERVAL_HOURS,
            cell_size: 1.0,
            horizon_cells: DEFAULT_HORIZON_CELLS,
        }
    }
}

/// One sun position of the daily integration.
struct SunStep {
    /// Solar azimuth, radians clockwise from north.
    azimuth: f64,
    /// Solar altitude above the horizon, radians; always positive here.
    altitude: f64,
    /// Clear-sky energy delivered on a horizontal surface during this step,
    /// in kWh/m².
    energy: f64,
}

/// Solar declination for a day of year, in radians.
///
/// Spencer's (1971) Fourier series, the series behind the NOAA Solar
/// Calculator's declination; accurate to about 0.0006 rad (0.035°).
///
/// # Arguments
/// * `day_of_year` – 1-based day of year; values outside `1..=366` are
///   clamped, so the function is total
///
/// # Returns
/// Declination in radians, positive in the northern summer.
#[must_use]
pub fn solar_declination_rad(day_of_year: u32) -> f64 {
    let day = f64::from(day_of_year.clamp(1, 366));
    let gamma = std::f64::consts::TAU * (day - 1.0) / 365.0;
    0.001_480f64.mul_add(
        (3.0 * gamma).sin(),
        0.002_697f64.mul_add(
            -(3.0 * gamma).cos(),
            0.000_907f64.mul_add(
                (2.0 * gamma).sin(),
                0.006_758f64.mul_add(
                    -(2.0 * gamma).cos(),
                    0.070_257f64
                        .mul_add(gamma.sin(), 0.399_912f64.mul_add(-gamma.cos(), 0.006_918)),
                ),
            ),
        ),
    )
}

/// Earth–Sun distance correction for a day of year (dimensionless).
///
/// Spencer's (1971) four-term series for the inverse relative distance; a
/// factor of 1.0 means mean distance.
///
/// # Arguments
/// * `day_of_year` – 1-based day of year; values outside `1..=366` are clamped
///
/// # Returns
/// Multiplicative correction on the solar constant, roughly `0.967..=1.034`.
#[must_use]
pub fn earth_sun_distance_factor(day_of_year: u32) -> f64 {
    let day = f64::from(day_of_year.clamp(1, 366));
    let gamma = std::f64::consts::TAU * (day - 1.0) / 365.0;
    0.000_077f64.mul_add(
        (2.0 * gamma).sin(),
        0.000_719f64.mul_add(
            (2.0 * gamma).cos(),
            0.001_280f64.mul_add(gamma.sin(), 0.034_221f64.mul_add(gamma.cos(), 1.000_110)),
        ),
    )
}

/// Solar altitude for a latitude, day and local solar time, in radians.
///
/// Altitude is the angle above the horizon; negative values mean the sun is
/// below the horizon and contribute no energy.
///
/// # Arguments
/// * `latitude_deg` – geographic latitude in degrees, clamped to ±90
/// * `day_of_year` – 1-based day of year, clamped to `1..=366`
/// * `solar_time_hours` – local solar time in hours; values outside `0..24`
///   are wrapped
///
/// # Returns
/// Solar altitude in radians.
#[must_use]
pub fn solar_altitude_rad(latitude_deg: f64, day_of_year: u32, solar_time_hours: f64) -> f64 {
    let latitude = clamp_latitude(latitude_deg);
    let declination = solar_declination_rad(day_of_year);
    let hour_angle = hour_angle_rad(solar_time_hours);

    latitude
        .sin()
        .mul_add(
            declination.sin(),
            latitude.cos() * declination.cos() * hour_angle.cos(),
        )
        // The two unit vectors keep the product inside [-1, 1] in exact
        // arithmetic; clamping absorbs the last-bit overshoot that would
        // otherwise turn into a NaN altitude at the poles.
        .clamp(-1.0, 1.0)
        .asin()
}

/// Solar azimuth for a latitude, day and local solar time, in radians.
///
/// Clockwise from north, as a compass bearing: 0 = north, π/2 = east, π =
/// south. Within [`ZENITH_COS_ALTITUDE`] of the solar zenith the azimuth is
/// both geometrically undefined and numerically noise (the formula divides by
/// `cos alt`, which vanishes there), so the function returns 0 (north) rather
/// than amplifying rounding into a wild bearing.
///
/// # Arguments
/// * `latitude_deg` – geographic latitude in degrees, clamped to ±90
/// * `day_of_year` – 1-based day of year, clamped to `1..=366`
/// * `solar_time_hours` – local solar time in hours; values outside `0..24`
///   are wrapped
///
/// # Returns
/// Solar azimuth in radians in `[0, 2π)`.
#[must_use]
pub fn solar_azimuth_rad(latitude_deg: f64, day_of_year: u32, solar_time_hours: f64) -> f64 {
    let latitude = clamp_latitude(latitude_deg);
    let declination = solar_declination_rad(day_of_year);
    let hour_angle = hour_angle_rad(solar_time_hours);
    let altitude = solar_altitude_rad(latitude_deg, day_of_year, solar_time_hours);

    let cos_altitude = altitude.cos();
    if cos_altitude < ZENITH_COS_ALTITUDE {
        return 0.0;
    }

    let cos_azimuth = altitude.sin().mul_add(-latitude.sin(), declination.sin())
        / (cos_altitude * latitude.cos());
    let azimuth = cos_azimuth.clamp(-1.0, 1.0).acos();
    if hour_angle > 0.0 {
        std::f64::consts::TAU - azimuth
    } else {
        azimuth
    }
}

/// Clear-sky daily potential insolation for every cell of a DEM.
///
/// Nighttime steps contribute nothing; daytime steps contribute their
/// clear-sky energy when the terrain horizon toward that sun position is
/// below the sun's altitude, and nothing when it is not. See the
/// [module documentation](self) for the model and its accuracy class.
///
/// # Arguments
/// * `dem` – 2D elevation grid, `f32` in metres
/// * `nodata` – elevation sentinel; cells `<= nodata` are copied through as
///   `nodata` rather than given a zero day
/// * `config` – latitude, day of year, integration interval, cell size and
///   shading march length; see [`SolarConfig`]
///
/// # Returns
/// 2D `f32` grid of daily insolation in kWh/m²/day, same shape as `dem`.
///
/// # Panics
/// Never — the integration is bounded (at most
/// [`MAX_INTEGRATION_STEPS`] steps) and the shading march is bounds-checked.
#[must_use]
pub fn solar_insolation(dem: &ArrayView2<f32>, nodata: f32, config: &SolarConfig) -> Array2<f32> {
    let rows = dem.nrows();
    let cols = dem.ncols();
    let steps = sun_steps(config);
    let cell_size = config.cell_size;

    let mut insolation = Array2::<f32>::zeros((rows, cols));
    for r in 0..rows {
        for c in 0..cols {
            let elevation = dem[[r, c]];
            if elevation <= nodata {
                insolation[[r, c]] = nodata;
                continue;
            }

            let mut total = 0.0_f64;
            for step in &steps {
                let horizon = horizon_angle(
                    dem,
                    r,
                    c,
                    nodata,
                    cell_size,
                    step.azimuth,
                    config.horizon_cells,
                );
                if horizon >= step.altitude {
                    continue;
                }
                total += step.energy;
            }
            insolation[[r, c]] = total as f32;
        }
    }

    insolation
}

/// Terrain horizon angle seen from a cell toward an azimuth, in radians.
///
/// Marches up to `horizon_cells` whole cells along the azimuth and returns
/// the largest elevation angle found, or `-1.0` (below every sun position)
/// when nothing rises above the cell. A non-positive `cell_size` disables
/// the march, as does `horizon_cells == 0`.
fn horizon_angle(
    dem: &ArrayView2<f32>,
    r: usize,
    c: usize,
    nodata: f32,
    cell_size: f32,
    azimuth: f64,
    horizon_cells: usize,
) -> f64 {
    if horizon_cells == 0 || cell_size <= 0.0 {
        return -1.0;
    }

    let rows = dem.nrows() as isize;
    let cols = dem.ncols() as isize;
    let elevation = f64::from(dem[[r, c]]);
    // Rows increase southward, so a northward bearing walks the rows down.
    let north_step = -azimuth.cos();
    let east_step = azimuth.sin();

    let mut best = -1.0_f64;
    for step in 1..=horizon_cells {
        let distance = step as f64;
        let sample_row = distance.mul_add(north_step, r as isize as f64).round() as isize;
        let sample_col = distance.mul_add(east_step, c as isize as f64).round() as isize;
        if sample_row < 0 || sample_row >= rows || sample_col < 0 || sample_col >= cols {
            break;
        }
        let sample = dem[[sample_row as usize, sample_col as usize]];
        if sample <= nodata {
            continue;
        }
        let angle = (f64::from(sample) - elevation).atan2(distance * f64::from(cell_size));
        if angle > best {
            best = angle;
        }
    }

    best
}

/// Sun positions and per-step energies of one day's integration.
fn sun_steps(config: &SolarConfig) -> Vec<SunStep> {
    let requested = if config.interval_hours.is_finite() && config.interval_hours > 0.0 {
        config.interval_hours
    } else {
        DEFAULT_INTERVAL_HOURS
    };

    // Between one and MAX_INTEGRATION_STEPS sun positions, whatever interval
    // the caller asks for; the width actually integrated follows from the
    // step count, so a clamped tiny interval still covers exactly 24 h.
    let step_count = (24.0 / requested)
        .ceil()
        .clamp(1.0, MAX_INTEGRATION_STEPS as f64) as usize;
    let interval = 24.0 / step_count as f64;

    let distance = earth_sun_distance_factor(config.day_of_year);
    let mut steps = Vec::new();
    for i in 0..step_count {
        // Midpoint rule: each step stands for the interval centred on it.
        let solar_time = (i as f64 + 0.5) * interval;
        let altitude = solar_altitude_rad(config.latitude_deg, config.day_of_year, solar_time);
        if altitude <= 0.0 {
            continue;
        }

        let air_mass = 1.0 / altitude.sin();
        let beam = TRANSMITTANCE.powf(air_mass);
        let direct = SOLAR_CONSTANT * distance * beam * altitude.sin();
        let diffuse = DIFFUSE_FRACTION * (1.0 - beam) * SOLAR_CONSTANT * distance * altitude.sin();
        let watts = direct + diffuse;

        steps.push(SunStep {
            azimuth: solar_azimuth_rad(config.latitude_deg, config.day_of_year, solar_time),
            altitude,
            energy: watts * interval * SECONDS_PER_HOUR / 3_600_000.0,
        });
    }

    steps
}

/// Latitude in degrees clamped into ±90, as radians.
const fn clamp_latitude(latitude_deg: f64) -> f64 {
    latitude_deg.clamp(-90.0, 90.0).to_radians()
}

/// Hour angle for a local solar time, in radians, wrapped into `(-π, π]`.
fn hour_angle_rad(solar_time_hours: f64) -> f64 {
    let wrapped = solar_time_hours.rem_euclid(24.0);
    std::f64::consts::PI * (wrapped - 12.0) / 12.0
}

#[cfg(test)]
mod tests {
    // The solar geometry is compared against hand-computed angles with a
    // tolerance for the series' own accuracy; an expect failure here IS the
    // test failing.
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::float_cmp)]

    use super::*;
    use std::f64::consts::{FRAC_PI_2, PI};

    #[test]
    fn test_declination_solstices_and_equinoxes() {
        // June solstice (day 172): ~+23.44°. December solstice (day 355):
        // ~-23.44°. Equinoxes (day 81 / 266): ~0.
        let june = solar_declination_rad(172);
        assert!(
            (june - 23.44_f64.to_radians()).abs() < 0.02,
            "June declination {june} rad"
        );
        let december = solar_declination_rad(355);
        assert!(
            (december + 23.44_f64.to_radians()).abs() < 0.02,
            "December declination {december} rad"
        );
        assert!(solar_declination_rad(81).abs() < 0.02, "March equinox");
        assert!(solar_declination_rad(266).abs() < 0.02, "September equinox");
    }

    #[test]
    fn test_earth_sun_distance_factor_range() {
        // Perihelion (early January) is ~3.4% closer, aphelion ~1.7% farther.
        assert!(
            (earth_sun_distance_factor(3) - 1.0334).abs() < 0.002,
            "perihelion factor"
        );
        assert!(
            (earth_sun_distance_factor(186) - 0.9670).abs() < 0.002,
            "aphelion factor"
        );
    }

    #[test]
    fn test_altitude_at_solar_noon() {
        // Northern summer, 40°N: noon altitude = 90 - 40 + 23.44 = 73.44°.
        let noon = solar_altitude_rad(40.0, 172, 12.0);
        assert!(
            (noon - 73.44_f64.to_radians()).abs() < 0.02,
            "noon altitude {noon} rad"
        );
        // Midnight on the same day is the anti-transit altitude, which is not
        // the mirror of noon: with hour angle π the sun sits at
        // lat + decl - 90° = 40 + 23.4 - 90 = -26.6° below the horizon.
        let decl = solar_declination_rad(172);
        let expected_midnight = 40.0_f64.to_radians() + decl - FRAC_PI_2;
        let midnight = solar_altitude_rad(40.0, 172, 0.0);
        assert!(midnight < 0.0, "sun is down at midnight");
        assert!(
            (midnight - expected_midnight).abs() < 1e-6,
            "midnight altitude {midnight} rad != {expected_midnight}"
        );
    }

    #[test]
    fn test_altitude_overhead_at_the_equator_on_the_equinox() {
        let noon = solar_altitude_rad(0.0, 81, 12.0);
        assert!(
            noon > FRAC_PI_2 - 0.02,
            "equinox equator noon altitude {noon} rad should be ~zenith"
        );
    }

    #[test]
    fn test_azimuth_runs_east_to_west_through_south() {
        // 40°N in summer: morning sun is in the east, noon in the south,
        // evening in the west.
        let morning = solar_azimuth_rad(40.0, 172, 8.0);
        let noon = solar_azimuth_rad(40.0, 172, 12.0);
        let evening = solar_azimuth_rad(40.0, 172, 16.0);
        assert!(
            (morning - FRAC_PI_2).abs() < 0.3,
            "morning azimuth {morning} should be near east"
        );
        assert!(
            (noon - PI).abs() < 0.05,
            "noon azimuth {noon} should be due south"
        );
        assert!(
            3.0f64.mul_add(-FRAC_PI_2, evening).abs() < 0.3,
            "evening azimuth {evening} should be near west"
        );
    }

    #[test]
    fn test_insolation_flat_grid_is_uniform_and_plausible() {
        // Flat terrain, no shading: every cell gets the same day, and a
        // clear-sky June day at 40°N lands in the high single digits of
        // kWh/m²/day.
        let dem = Array2::<f32>::zeros((3, 3));
        let config = SolarConfig {
            latitude_deg: 40.0,
            day_of_year: 172,
            cell_size: 30.0,
            ..SolarConfig::default()
        };
        let grid = solar_insolation(&dem.view(), -32768.0, &config);
        let value = f64::from(grid[[1, 1]]);
        assert!(
            (5.0..=11.0).contains(&value),
            "clear-sky June day at 40N was {value} kWh/m2/day"
        );
        for r in 0..3 {
            for c in 0..3 {
                assert_eq!(grid[[r, c]], grid[[1, 1]], "flat grid must be uniform");
            }
        }
    }

    #[test]
    fn test_insolation_summer_exceeds_winter_at_mid_latitude() {
        let dem = Array2::<f32>::zeros((2, 2));
        let summer = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 45.0,
                day_of_year: 172,
                ..SolarConfig::default()
            },
        );
        let winter = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 45.0,
                day_of_year: 5,
                ..SolarConfig::default()
            },
        );
        let summer_peak = summer[[0, 0]];
        let winter_peak = winter[[0, 0]];
        assert!(
            f64::from(summer_peak) > 3.0 * f64::from(winter_peak),
            "summer {summer_peak} vs winter {winter_peak}"
        );
    }

    #[test]
    fn test_insolation_polar_day_and_night() {
        let dem = Array2::<f32>::zeros((2, 2));
        // Midsummer at the north pole is a 24-hour day; at the south pole the
        // sun never rises, so the whole grid is exactly zero.
        let north = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 89.0,
                day_of_year: 172,
                ..SolarConfig::default()
            },
        );
        let polar_day = north[[0, 0]];
        assert!(f64::from(polar_day) > 4.0, "polar day {polar_day}");
        let south = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: -89.0,
                day_of_year: 172,
                ..SolarConfig::default()
            },
        );
        assert_eq!(south[[0, 0]], 0.0, "polar night contributes nothing");
    }

    #[test]
    fn test_insolation_south_wall_shades_northern_winter() {
        // A 1000 m wall filling the row south of the target, over 1 m cells,
        // puts the terrain horizon at ~89.9° for every winter sun position at
        // 45°N — they are all southern — so the target's day is exactly zero.
        // The same wall to the north shades nothing, because the winter sun
        // at 45°N never leaves the southern sky.
        let config = SolarConfig {
            latitude_deg: 45.0,
            day_of_year: 5,
            cell_size: 1.0,
            ..SolarConfig::default()
        };

        let mut dem = Array2::<f32>::zeros((3, 3));
        for c in 0..3 {
            dem[[2, c]] = 1000.0; // south of the target at (1, 1)
        }
        let shaded = solar_insolation(&dem.view(), -32768.0, &config);
        assert_eq!(
            shaded[[1, 1]],
            0.0,
            "a wall to the south blocks the whole day"
        );
        assert!(
            f64::from(shaded[[2, 1]]) > 0.0,
            "the wall top still sees the sky"
        );

        let mut dem = Array2::<f32>::zeros((3, 3));
        for c in 0..3 {
            dem[[0, c]] = 1000.0; // north of the target
        }
        let open = solar_insolation(&dem.view(), -32768.0, &config);
        let flat = solar_insolation(&Array2::<f32>::zeros((3, 3)).view(), -32768.0, &config);
        assert_eq!(
            open[[1, 1]],
            flat[[1, 1]],
            "a north wall cannot shade a winter day at 45N"
        );
    }

    #[test]
    fn test_insolation_horizon_cells_zero_disables_shading() {
        let mut dem = Array2::<f32>::zeros((3, 3));
        dem[[2, 1]] = 1000.0;
        let config = SolarConfig {
            latitude_deg: 45.0,
            day_of_year: 5,
            cell_size: 1.0,
            horizon_cells: 0,
            ..SolarConfig::default()
        };
        let grid = solar_insolation(&dem.view(), -32768.0, &config);
        assert!(
            f64::from(grid[[1, 1]]) > 0.0,
            "with no march there is no shade"
        );
    }

    #[test]
    fn test_insolation_nodata_cells_carry_the_sentinel() {
        let dem = ndarray::arr2(&[[-32768.0_f32, 100.0], [100.0, 100.0]]);
        let grid = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 40.0,
                day_of_year: 172,
                ..SolarConfig::default()
            },
        );
        assert_eq!(grid[[0, 0]], -32768.0, "nodata is copied through verbatim");
        assert!(f64::from(grid[[1, 1]]) > 0.0);
    }

    #[test]
    fn test_insolation_nodata_in_the_march_is_skipped_not_a_wall() {
        // The target at (0,0) looks east over a nodata hole at (0,2) to a
        // 1000 m wall at (0,5). Near the pole the sun's azimuth sweeps the
        // full circle, so the eastward march runs; skipping the hole means
        // the wall is still found and the day is shaded, where treating the
        // hole as terrain would have stopped the march and left the day open.
        let dem = ndarray::arr2(&[[0.0_f32, 0.0, -32768.0, 0.0, 0.0, 1000.0]]);
        let config = SolarConfig {
            latitude_deg: 89.0,
            day_of_year: 172,
            cell_size: 1.0,
            ..SolarConfig::default()
        };
        let shaded = f64::from(solar_insolation(&dem.view(), -32768.0, &config)[[0, 0]]);
        let flat = f64::from(
            solar_insolation(&Array2::<f32>::zeros((1, 6)).view(), -32768.0, &config)[[0, 0]],
        );
        assert!(
            shaded < flat,
            "the wall beyond the nodata hole must still shade ({shaded} vs {flat})"
        );
    }

    #[test]
    fn test_insolation_is_stable_across_integration_intervals() {
        // Coarsening the step from 0.5 h to 1 h moves a smooth daily curve by
        // a few percent at most.
        let dem = Array2::<f32>::zeros((2, 2));
        let fine = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 40.0,
                day_of_year: 172,
                interval_hours: 0.25,
                ..SolarConfig::default()
            },
        );
        let coarse = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 40.0,
                day_of_year: 172,
                interval_hours: 1.0,
                ..SolarConfig::default()
            },
        );
        let fine_value = f64::from(fine[[0, 0]]);
        let coarse_value = f64::from(coarse[[0, 0]]);
        let relative = (fine_value - coarse_value).abs() / fine_value;
        assert!(relative < 0.02, "0.25 h vs 1 h differs by {relative:.4}");
    }

    #[test]
    fn test_insolation_handles_degenerate_configurations() {
        // Non-finite interval, absurd march length and a zero cell size must
        // all stay bounded and produce a grid rather than a panic.
        let dem = Array2::<f32>::zeros((2, 2));
        let grid = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 400.0,
                day_of_year: 9_999,
                interval_hours: f64::NAN,
                cell_size: 0.0,
                horizon_cells: 100_000,
            },
        );
        assert_eq!(grid.nrows(), 2);
        let degenerate = grid[[0, 0]];
        assert!(degenerate.is_finite(), "non-finite insolation {degenerate}");
    }

    #[test]
    fn test_insolation_tiny_interval_is_clamped_to_the_step_cap() {
        // 0.001 h would be 24,000 sun positions; the clamp holds it at
        // MAX_INTEGRATION_STEPS of 3 minutes each, so the run stays bounded
        // and lands within a few percent of a coarser day.
        let dem = Array2::<f32>::zeros((2, 2));
        let tiny = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 40.0,
                day_of_year: 172,
                interval_hours: 0.001,
                ..SolarConfig::default()
            },
        );
        let coarse = solar_insolation(
            &dem.view(),
            -32768.0,
            &SolarConfig {
                latitude_deg: 40.0,
                day_of_year: 172,
                ..SolarConfig::default()
            },
        );
        let tiny_value = f64::from(tiny[[0, 0]]);
        let coarse_value = f64::from(coarse[[0, 0]]);
        let relative = (tiny_value - coarse_value).abs() / coarse_value;
        assert!(tiny_value > 0.0, "clamped day still delivers {tiny_value}");
        assert!(
            relative < 0.01,
            "clamped run differs from 0.5 h by {relative:.4}"
        );
    }

    #[test]
    fn test_azimuth_at_the_zenith_reports_north() {
        // Local noon on the day the sun passes exactly overhead: the azimuth
        // is geometrically undefined and the documented answer is 0 (north)
        // rather than a NaN.
        let latitude = solar_declination_rad(172).to_degrees();
        let azimuth = solar_azimuth_rad(latitude, 172, 12.0);
        let altitude = solar_altitude_rad(latitude, 172, 12.0);
        assert!(
            (altitude - std::f64::consts::FRAC_PI_2).abs() < 1e-6,
            "the sun should be at the zenith, got {altitude}"
        );
        assert_eq!(azimuth, 0.0, "zenith azimuth is reported as north");
    }
}
