# OpenZenith — SAR & Open Data Source Research

**Date:** 2026-04-20  
**Scope:** SAR data access, data source improvements, dead source replacements  
**Method:** Every source tested live from server — no assumptions.

---

## Executive Summary

**NASA GIBS WMS** is the single most valuable discovery. It hosts **~900 unique WMS layers** (from 1518 total names) accessible via standard WMS — **no auth, no API keys, ~300ms latency from CF edge, no-store cache headers** (always fresh).

We tested 65 candidate layers individually. **52 returned real data** (≥1KB), **13 returned empty** (transparent tiles at the tested bbox/zoom). Of the 52 live layers, **~35 are immediately implementable** as new MapLibre raster tile layers using the same proxy pattern as our existing `landcover`, `population`, and `sentinel2` routes.

**Key SAR finding:** OPERA (NASA JPL) produces pre-rendered WMS tiles from Sentinel-1 SAR data on GIBS. This means we can display actual SAR imagery (RTC backscatter), SAR-derived flood detection (DSWx), and disturbance alerts — all without processing raw SAR data.

---

## 1. Current Source Health Audit

| # | Source | Status | Notes |
|---|--------|--------|-------|
| 1 | USGS Earthquakes | ✅ 200 | 45KB, 110ms |
| 2 | FIRMS Wildfires | ✅ 400 | Expected (no key in URL — key added in code) |
| 3 | Celestrak Satellites | ✅ 200 | 2.5MB, 3.1s |
| 4 | NHC Hurricanes | ✅ 200 | 24B (no active storms) |
| 5 | NLNOG Ring | ❌ 404 | Was working — endpoint changed |
| 6 | OpenSky Flights | ✅ 200 | 743KB, 1.1s (SWR pattern) |
| 7 | AISstream Vessels | ❌ Dead | WebSocket connects but delivers nothing |
| 8 | USGS Volcanoes | ❌ 404 | `volcanoes.usgs.gov/feed/v0.1/all.geojson` dead |
| 9 | GDACS Alerts | ❌ Dead | RSS → admin HTML, JSON/Atom → 404 |
| 10 | SWPC Aurora | ✅ 200 | Code fetches from different URL (`ovation_aurora_latest.json`) |
| 11 | Open-Meteo AQ | ✅ 200 | Working |
| 12 | Open-Meteo Marine | ✅ 200 | Working |
| 13 | AWC SIGMETs | ✅ 200 | Working |
| 14 | RainViewer Radar | ✅ 200 | Working |
| 15 | NASA EONET Events | ✅ 200 | 4.5MB |
| 16 | Blitzortung Lightning | ✅ WSS | Client-side WebSocket |

**5 sources are now broken** (NLNOG, AISstream, USGS Volcanoes, GDACS, + space weather needs URL check).

---

## 2. SAR Data — What's Available

### 2A. OPERA Products (via GIBS — Pre-rendered, Immediate)

OPERA = Observational Products for End-users from Remote Sensing Analysis. NASA JPL processes Sentinel-1 SAR into analysis-ready products. **GIBS serves these as WMS tiles.**

| Product | GIBS Layer | Live? | Zoom | What It Shows |
|---------|-----------|-------|------|---------------|
| **RTC-S1 Backscatter** | `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` | ✅ z0-3 | ✅ | Sentinel-1 VV/VH backscatter (actual SAR image) |
| **DSWx-S1** (Dynamic Surface Water) | `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` | ✅ z0-3 | ✅ | SAR-based flood/water detection |
| **DIST-ALERT-HLS** | `OPERA_L3_DIST-ALERT-HLS_Color_Index` | ✅ z0-8 | ✅ | Surface disturbance (fire, deforestation, urbanization) |
| **DIST-ANN-HLS** | `OPERA_L3_DIST-ANN-HLS_Color_Index` | ✅ z0-8 | ✅ | Annual disturbance change |

**Zoom limitation:** OPERA RTC-S1 and DSWx-S1 only have data at z0-z3 (global to continental). This is because they're mosaics covering large areas. DIST-ALERT works to z8+ (regional).

### 2B. SMAP (NASA — Radar Radiometer)

| Product | GIBS Layer | Live? | Zoom | What It Shows |
|---------|-----------|-------|------|---------------|
| **Active Soil Moisture** | `SMAP_L3_Active_Soil_Moisture` | ✅ z0-3 | ✅ | L-band radar soil moisture |
| **Sigma0 VV** | `SMAP_L3_Active_Sigma0_VV` | ✅ z0-3 | ✅ | Raw SAR backscatter from SMAP |
| **Sigma0 HH** | `SMAP_L3_Active_Sigma0_HH` | ✅ z0-3 | ✅ | HH polarization backscatter |
| **Sea Surface Salinity** | `SMAP_L3_Sea_Surface_Salinity_CAP_Monthly` | ✅ z0-3 | ✅ | L-band radiometer salinity |
| **S1+SMAP Active-Passive** | `SMAP_Sentinel-1_L2_Active_Passive_Soil_Moisture` | ⚪ empty | — | Combined product (no data at tested tiles) |

### 2C. Raw SAR Data Access (Not Viable for Edge)

| Source | Access | Auth | Size per scene | Edge Viable? |
|--------|--------|------|---------------|-------------|
| **Sentinel-1 GRD** | Copernicus Dataspace STAC | Free (slow) | ~200MB | ❌ |
| **Sentinel-1 SLC** | Copernicus Dataspace | Free | ~2GB | ❌ |
| **OPERA RTC-S1** | AWS S3 `opera-pst-rs-pop1` | Earthdata login | ~50MB | ❌ |
| **ALOS PALSAR-2** | JAXA | Restricted | ~1GB | ❌ |
| **NISAR** | PO.DAAC (200 OK page) | Not yet operational | TBD | ❌ |

**Bottom line:** Raw SAR requires downloading 50MB-2GB scenes and processing. CF Workers have 128MB/30s limits. **Use OPERA GIBS tiles instead** — zero processing needed.

### 2D. InSAR (Interferometric SAR) — Subsidence

| Source | Status | Notes |
|--------|--------|-------|
| **COMET-LiCS** | Portal alive (200), API 404 | Requires bulk download of pre-processed velocity GeoTIFFs |
| **Altamira (USGS)** | Dead (000) | Service shut down |
| **NISAR L3 InSAR** | Not yet available | NISAR launched 2025, products not yet in GIBS |

**Path forward for subsidence:** Download COMET-LiCS velocity mosaic (one-time ~2GB download), generate XYZ tiles locally, upload to R2. Static layer, no updates needed.

---

## 3. Layers That Fill Dead/Broken Sources

### 🔴 CRITICAL — Fixes Currently Broken Layers

| Broken Source | GIBS Replacement | Impact |
|---------------|-----------------|--------|
| **Floods** (Copernicus EMS dead → currently empty) | `VIIRS_Combined_Flood_3-Day` | **Actual flood monitoring restored!** |
| **Volcanoes** (USGS feed 404) | `TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column` | Real-time SO₂ plume detection (catches eruptions) |
| **GDACS** (API dead → currently empty) | Can't be replaced by tiles | Stays empty — GDACS portal itself shows events but no accessible API |
| **NLNOG** (404) | No direct replacement | Need to find new endpoint |

### 🟡 HIGH — New Capabilities From SAR Data

| New Layer | GIBS Name | Live? | Best Zoom | Data Freshness |
|-----------|-----------|-------|-----------|----------------|
| **SAR Backscatter** | `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` | ✅ | z0-3 | Days |
| **Dynamic Surface Water** | `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` | ✅ | z0-3 | Days |
| **Disturbance Alerts** | `OPERA_L3_DIST-ALERT-HLS_Color_Index` | ✅ | z0-8 | Daily |
| **Fire Temperature** | `GOES-East_ABI_FireTemp` | ✅ | z0-3 | 10 min |
| **SMAP Soil Moisture** | `SMAP_L3_Active_Soil_Moisture` | ✅ | z0-3 | 3 days |

---

## 4. Complete GIBS Layer Catalog (Tested, Recommended)

### Tier 1: ⭐ Best New Layers (Immediate Impact)

| Layer | GIBS Name | Category | Zoom | Size | Why Add |
|-------|-----------|----------|------|------|---------|
| **Flood Extent** | `VIIRS_Combined_Flood_3-Day` | Disaster | z0-3 | 3.7KB | Replaces dead Copernicus EMS |
| **Fire Temperature** | `GOES-East_ABI_FireTemp` + `GOES-West_ABI_FireTemp` | Fire | z0-3 | 15KB | Real-time thermal fire detection |
| **SAR Backscatter** | `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` | SAR | z0-3 | 3KB | Actual SAR imagery from S1 |
| **Surface Water** | `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1` | Hydro | z0-3 | 3.2KB | SAR-based water body mapping |
| **Disturbance Alerts** | `OPERA_L3_DIST-ALERT-HLS_Color_Index` | Environment | z0-8 | 4.9KB | Deforestation, fire damage, urbanization |
| **SO₂ (Volcanic Gas)** | `TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column` | Volcanic | z0-8 | 10.9KB | Detects eruptions in real-time |
| **Precipitation** | `IMERG_Precipitation_Rate` | Weather | z0-3 | 16KB | GPM half-hourly global |
| **Soil Moisture** | `SMAP_L3_Active_Soil_Moisture` | Hydro | z0-3 | 14.4KB | Radar-derived from SMAP |
| **NO₂ (Air Pollution)** | `TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column` | Air Quality | z0-3 | 12.4KB | Daily, satellite-derived |
| **Population 2020** | `GPW_Population_Density_2020` | Infrastructure | z0-8 | 9.8KB | Census-based, better than night lights |
| **Sea Surface Temp** | `GHRSST_L4_MUR25_Sea_Surface_Temperature` | Ocean | z0-3 | 27.3KB | 25km satellite SST |
| **Ocean Currents** | `OSCAR_Sea_Surface_Currents_Zonal` + `_Meridional` | Ocean | z0-3 | 39KB | Real ocean circulation |
| **Chlorophyll-a** | `MODIS_Aqua_L2_Chlorophyll_A` | Ocean | z0-3 | 16.5KB | Ocean color / phytoplankton |
| **NDVI** | `MODIS_Terra_L3_NDVI_16Day` | Vegetation | z0-8 | 15.4KB | Global vegetation index |
| **LAI** | `MODIS_Combined_L4_LAI_8Day` | Vegetation | z0-8 | 11.5KB | Leaf Area Index |
| **SST Daily 4km** | `MODIS_Aqua_L3_SST_Thermal_4km_Day_Daily` | Ocean | z0-3 | 17.1KB | Higher res SST |

### Tier 2: 🌍 Environment & Climate

| Layer | GIBS Name | Category | Zoom | Size |
|-------|-----------|----------|------|------|
| **Canopy Height** | `GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303` | Terrain | z0-8 | 10KB |
| **Biomass** | `GEDI_ISS_L4B_Aboveground_Biomass_Density_Mean_201904-202303` | Environment | z0-8 | 11.1KB |
| **FPAR** | `MODIS_Combined_L4_FPAR_8Day` | Vegetation | z0-8 | 14.9KB |
| **Snow Cover** | `MODIS_Terra_L3_Snow_Extent_8Day` | Weather | z0-8 | 3.3KB |
| **PM2.5** | `Particulate_Matter_Below_2.5micrometers_2010-2012` | Air Quality | z0-8 | 10.8KB |
| **Urban Heat Island** | `UHI_Urban-Rural_Summer_Day_Max_Land_Surface_Temp_Difference_2013` | Climate | z0-8 | 1.2KB |
| **Sea Surface Salinity** | `SMAP_L3_Sea_Surface_Salinity_CAP_Monthly` | Ocean | z0-3 | 29.3KB |
| **Sea Surface Height** | `JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies` | Ocean | z0-3 | 27.5KB |
| **Aerosol Optical Depth** | `MODIS_Aqua_AOD_Deep_Blue_Combined` | Air Quality | z0-3 | 1.4KB |
| **Solar Induced Fluorescence** | `OCO-2_Solar_Induced_Florescence_Blended` | Vegetation | z0-3 | 2.3KB |
| **GRACE Water** | `GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI` | Hydro | z0-8 | small |
| **Ground NO2** | `Ground_Level_Nitrogen_Dioxide_3_Year_Running_Mean_2010-2012` | Air Quality | z0-8 | 10.2KB |

### Tier 3: 🏗️ Infrastructure & Reference

| Layer | GIBS Name | Category | Zoom | Size |
|-------|-----------|----------|------|------|
| **Global Dams** | `GRanD_Dams` | Infrastructure | z0-3 | 22.2KB |
| **Reservoirs** | `GRanD_Reservoirs` | Infrastructure | z0-3 | 1.9KB |
| **Nuclear Power Plants** | `Nuclear_Power_Plant_Locations` | Infrastructure | z0-3 | 8.7KB |
| **Human Settlement** | `Landsat_Human_Built-up_And_Settlement_Extent` | Population | z0-8 | 3.4KB |
| **Human Footprint** | `Human_Footprint_1995-2004` | Environment | z0-8 | 13.3KB |
| **Flood Hazard** | `NDH_Flood_Hazard_Frequency_Distribution_1985-2003` | Risk | z0-8 | 4.7KB |
| **Drought Hazard** | `NDH_Drought_Hazard_Frequency_Distribution_1980-2000` | Risk | z0-8 | 4.4KB |
| **Cyclone Hazard** | `NDH_Cyclone_Hazard_Frequency_Distribution_1980-2000` | Risk | z0-8 | 7.7KB |
| **Landslide Hazard** | `NDH_Landslide_Hazard_Distribution_2000` | Risk | z0-8 | 6KB |
| **Mammal Richness** | `Mammal_Richness_Grids_All_Species_2013` | Biodiversity | z0-3 | 21.6KB |
| **Mammal Richness (Threatened)** | `Mammal_Richness_Grids_Critically_Endangered_Species_2013` | Biodiversity | z0-3 | small |
| **ASTER DEM Relief** | `ASTER_GDEM_Color_Shaded_Relief` | Terrain | z0-8 | 65.7KB |
| **Blue Marble + Bathymetry** | `BlueMarble_ShadedRelief_Bathymetry` | Imagery | z0-8 | large |
| **HLS Sentinel-2 Daily** | `HLS_S30_Nadir_BRDF_Adjusted_Reflectance` | Imagery | z0-3 | 63.9KB |
| **HLS Landsat Daily** | `HLS_L30_Nadir_BRDF_Adjusted_Reflectance` | Imagery | z0-3 | 16.5KB |

### Tier 4: 🔬 Scientific / Specialized

| Layer | GIBS Name | Category | Zoom | Notes |
|-------|-----------|----------|------|-------|
| SMAP Sigma0 VV | `SMAP_L3_Active_Sigma0_VV` | SAR | z0-3 | Raw radar backscatter |
| SMAP Sigma0 HH | `SMAP_L3_Active_Sigma0_HH` | SAR | z0-3 | HH polarization |
| Lightning Climatology | `LIS_Very_High_Resolution_Lightning_Full_Climatology_LIS_Mean_Flash_Rate` | Weather | z0-8 | Static baseline |
| GEDI Ground Elevation | `GEDI_ISS_L3_Elevation_Mean_Lowest_Mode_201904-202303` | Terrain | z0-8 | LiDAR ground return |
| Carbon Monoxide | `MOPITT_CO_Daily_Total_Column_Day` | Climate | z0-3 | CO from MOPITT |
| Ozone | `OMI_Ozone_DOAS_Total_Column` | Climate | z0-3 | Total column ozone |
| Methane | `AIRS_L2_Methane_400hPa_Volume_Mixing_Ratio_Day` | Climate | z0-3 | CH4 at 400hPa |
| UV Index | `OMI_UV_Index` | Health | z0-3 | UV radiation |
| Net Ecosystem Exchange | `SMAP_L4_Mean_Net_Ecosystem_Exchange` | Carbon | z0-3 | Carbon flux |
| Gross Primary Productivity | `SMAP_L4_Mean_Gross_Primary_Productivity` | Carbon | z0-3 | Plant productivity |
| Soil Temperature | `SMAP_L4_Soil_Temperature_Layer_1` | Climate | z0-3 | Subsurface temp |
| Snow Water Equivalent | `SMAP_L4_Snow_Mass` | Weather | z0-3 | Snow water content |
| Net Migration | `Estimated_Net_Migration_1990-2000` | Demographics | z0-8 | 3 decades available |
| Probable Urban Expansion | `Probabilities_of_Urban_Expansion_2000-2030` | Demographics | z0-8 | Future prediction |

---

## 5. Improvements to Existing Layers

### 5A. Population Layer (replace VIIRS Black Marble proxy)
- **Current:** `VIIRS_Black_Marble` (night lights as population proxy) — works but is a proxy
- **Better:** `GPW_Population_Density_2020` — actual census-based population data at 30 arc-seconds (~1km)
- **Implementation:** Change the GIBS layer name in the `/api/population/{z}/{x}/{y}` route
- **Also available:** GPW 2000, 2005, 2010, 2015 for time comparison

### 5B. Marine Weather (add SST tiles)
- **Current:** Sparse grid points from Open-Meteo JSON API
- **Add:** `GHRSST_L4_MUR25_Sea_Surface_Temperature` as a raster tile layer
- **Or:** `MODIS_Aqua_L3_SST_Thermal_4km_Day_Daily` for higher resolution

### 5C. Volcanoes (fix dead USGS feed)
- **Current:** `volcanoes.usgs.gov/feed/v0.1/all.geojson` → 404
- **Code uses:** `volcano.si.edu/news/WeeklyVolcanoRSS.xml` (Smithsonian GVP) — check if alive
- **Add tile layer:** `TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column` for real-time SO₂ detection

### 5D. Sentinel-2 Imagery (better source)
- **Current:** TiTiler (often down, 530) + GIBS MODIS Terra True Color fallback
- **Better:** `HLS_S30_Nadir_BRDF_Adjusted_Reflectance` — daily Sentinel-2 via GIBS (no TiTiler dependency!)
- **Zoom limitation:** z0-3 (similar to current fallback)

### 5E. Satellite Imagery (GOES) — add GeoColor
- **Current:** GOES-East imagery via separate handler
- **Add:** `GOES-East_ABI_GeoColor` (43.7KB, beautiful imagery) and `GOES-West_ABI_GeoColor`
- **Also:** `Himawari_AHI_Band3_Red_Visible_1km` (Japan coverage)

---

## 6. Non-GIBS Sources

| Source | Status | Viable? | Notes |
|--------|--------|---------|-------|
| **Microsoft Planetary Computer** | ✅ 200, 1.7MB | Raw data only | STAC search works but items too large for edge |
| **Copernicus Dataspace** | ✅ STAC search | Requires download | S1 GRD searchable, 0 items at tested bbox |
| **ASF DAAC** | ⚠️ 6.4s response | Slow from CF edge | Search API works but slow |
| **OPERA S3 (AWS)** | ✅ List buckets | Earthdata auth for download | Raw products accessible but need auth |
| **Sentinel-1 AWS Open Data** | ❌ 403 | Requires AWS credentials | Was open, now restricted |
| **GDACS** | ❌ Dead | No replacement | RSS/JSON/Atom all broken. Homepage shows events but no API |
| **USGS Volcanoes** | ❌ 404 | Smithsonian GVP in code | Check if `volcano.si.edu` RSS still works |
| **NLNOG** | ❌ 404 | Endpoint changed | Need to find new API URL |
| **AISstream** | ❌ Dead | Needs hardware or paid API | RTL-SDR ($83) or MarineTraffic ($free tier) |
| **ADSB Exchange** | ❌ 404 | $30/yr subscription | API returns nothing without auth |

---

## 7. Implementation Blueprint

### Pattern (identical for all GIBS layers)

```
API Route: /api/{layer-name}/{z}/{x}/{y}
  → Proxy to GIBS WMS with LAYERS={gibs_name}
  → R2 cache the response
  → Return PNG

MapLibre Layer:
  → raster source pointing to /api/{layer-name}/{z}/{x}/{y}
  → Appropriate opacity (0.6-0.9)
  → RASTER_LAYERS set update
```

### Recommended Sprint Order

**Sprint 1 — Fix Broken Sources (3 changes)**
1. Fix Volcanoes: Verify Smithsonian GVP RSS, add TROPOMI SO₂ tile layer
2. Fix GDACS: Accept it's dead, improve status message
3. Fix NLNOG: Find new endpoint or gracefully disable

**Sprint 2 — Fill Critical Gaps (5 new tile routes)**
4. Flood Extent: `VIIRS_Combined_Flood_3-Day` → `/api/floods-tile/{z}/{x}/{y}` *(partially done)*
5. Fire Temperature: `GOES-East_ABI_FireTemp` → `/api/fire-temperature/{z}/{x}/{y}` *(partially done)*
6. SAR Backscatter: `OPERA_L2_Radiometric_Terrain_Corrected_SAR_Sentinel-1` *(partially done)*
7. Dynamic Surface Water: `OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1`
8. Disturbance Alerts: `OPERA_L3_DIST-ALERT-HLS_Color_Index`

**Sprint 3 — Environmental Monitoring (7 new tile routes)**
9. SO₂ Volcanic: `TROPOMI_L2_Sulfur_Dioxide_Total_Vertical_Column`
10. NO₂ Air Pollution: `TROPOMI_L2_Nitrogen_Dioxide_Tropospheric_Column`
11. Precipitation: `IMERG_Precipitation_Rate`
12. Soil Moisture: `SMAP_L3_Active_Soil_Moisture`
13. NDVI: `MODIS_Terra_L3_NDVI_16Day`
14. Sea Surface Temp: `GHRSST_L4_MUR25_Sea_Surface_Temperature`
15. Chlorophyll-a: `MODIS_Aqua_L2_Chlorophyll_A`

**Sprint 4 — Ocean & Terrain (7 new tile routes)**
16. Ocean Currents: `OSCAR_Sea_Surface_Currents_Zonal`
17. Sea Surface Salinity: `SMAP_L3_Sea_Surface_Salinity_CAP_Monthly`
18. Sea Surface Height: `JPL_MEaSUREs_L4_Sea_Surface_Height_Anomalies`
19. Canopy Height: `GEDI_ISS_L3_Canopy_Height_Mean_RH100_201904-202303`
20. Biomass: `GEDI_ISS_L4B_Aboveground_Biomass_Density_Mean_201904-202303`
21. Snow Cover: `MODIS_Terra_L3_Snow_Extent_8Day`
22. ASTER DEM: `ASTER_GDEM_Color_Shaded_Relief`

**Sprint 5 — Risk, Air Quality & Infrastructure (8 new tile routes)**
23. Flood Hazard: `NDH_Flood_Hazard_Frequency_Distribution_1985-2003`
24. Landslide Hazard: `NDH_Landslide_Hazard_Distribution_2000`
25. Drought Hazard: `NDH_Drought_Hazard_Frequency_Distribution_1980-2000`
26. PM2.5: `Particulate_Matter_Below_2.5micrometers_2010-2012`
27. AOD: `MODIS_Aqua_AOD_Deep_Blue_Combined`
28. Global Dams: `GRanD_Dams`
29. Nuclear Plants: `Nuclear_Power_Plant_Locations`
30. Human Footprint: `Human_Footprint_1995-2004`

**Sprint 6 — Existing Layer Improvements**
31. Population: Switch to `GPW_Population_Density_2020`
32. Sentinel-2: Add `HLS_S30` as primary (daily, no TiTiler)
33. Marine Weather: Add `MUR SST` raster alongside Open-Meteo points
34. Satellite Imagery: Add `GOES-East_ABI_GeoColor` as basemap option

**Total: ~34 new/improved layers from a single WMS endpoint (GIBS)**

---

## 8. Technical Notes

### GIBS Cache Behavior
- All GIBS tiles have `Cache-Control: max-age=0, no-store, no-cache, must-revalidate`
- Always returns fresh data from CloudFront (`X-Cache: Miss`)
- **Our R2 cache is essential** — without it, every tile request hits GIBS (~300ms each)
- Recommended R2 TTL: 1 hour for weather, 24 hours for static, 7 days for reference

### Latency from CF Edge
- GIBS consistently returns in **270-540ms** from our server
- With R2 cache hits: **<10ms**
- With CF CDN cache (on user browser): **0ms after first load**

### Zoom Level Limitations
- Most MODIS/GPM/SMAP products: **z0-z3** (global to continental)
- Higher-resolution products (GEDI, GPW, HLS, NDVI, risk maps): **z0-z8+**
- OPERA RTC-S1 and DSWx-S1: **z0-z3** (coarse mosaics)
- OPERA DIST-ALERT: **z0-z8** (finer resolution)

### Bundle Size Impact
- Each GIBS tile route is ~2.5KB of code
- Each MapLibre layer dispatcher is ~1KB
- 34 layers ≈ **~120KB** additional code
- Since CF Pages inlines all dynamic imports, this adds to the single worker bundle
- **Recommendation:** Implement in batches of 5-8, measure bundle impact

---

## 9. Blocked / Future

| Item | Blocker | Path Forward |
|------|---------|-------------|
| COMET-LiCS subsidence | No pre-processed tiles | Download ~2GB GeoTIFF, generate XYZ tiles, upload to R2 |
| Raw Sentinel-1 processing | 200MB+/scene, 30s limit | Use OPERA GIBS tiles (already pre-processed) |
| NISAR products | Not yet in GIBS | Will appear eventually — monitor |
| Vessel AIS | All free APIs dead | RTL-SDR ($83) + antenna, or paid MarineTraffic |
| ADSB Exchange | $30/yr subscription | Low priority — OpenSky covers most commercial flights |
| GDACS | Portal alive but API dead | No replacement — use EONET events instead |
| CO₂ column (`OCO-2`) | Returns empty at all tested bboxes | May need specific date/time — investigate further |
