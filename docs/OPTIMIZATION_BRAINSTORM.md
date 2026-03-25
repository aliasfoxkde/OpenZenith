Question: Do you think it would be possible to use either AVIF or HEIF formats in conjunction with making my own custom binary format, to achieve extensive compression? While still retaining 1m (or better over time) resolution and accuracy? Can the format shortcomings be overcome in code, metadata and so on?

Response:
Short answer: **yes, you can use AVIF/HEIF as a component of a custom DEM container and get very strong compression**, but **not if you treat them like normal images**. To keep **~1 m vertical accuracy** you’d need a specific encoding strategy and metadata around the codec. Done right, it can work surprisingly well.

Let’s break down what’s actually feasible.

---

# The core problem with AVIF / HEIF for elevation

These formats were built for **visual images**, not **scientific raster data**.

Main limitations:

1. Limited bit-depth pipelines in typical encoders
2. Color transforms applied automatically
3. Lossy transforms that introduce ringing
4. No inherent geospatial metadata
5. Quantization designed for perception, not accuracy

But most of these **can be controlled or bypassed**.

---

# The key trick: don’t store raw elevation directly

Instead store:

**normalized residual elevation tiles**

This is how you preserve precision.

Example pipeline:

### Step 1 — Tile the DEM

Typical:

```
256×256 or 512×512 elevation grid
```

---

### Step 2 — Store base height + scale

For each tile:

```
base_height
scale
```

Then encode values as:

```
encoded_value = (elevation - base_height) / scale
```

Example:

```
base_height = 1023.5 m
scale = 0.1 m
```

Now values fit inside small integer ranges.

This dramatically improves compression.

---

# Why this works with AVIF

AV1 compression (inside AVIF) is extremely good at:

• Smooth gradients
• Low entropy fields
• Spatial prediction

Terrain has exactly these properties.

So if you feed it **normalized terrain**, compression becomes absurdly efficient.

That’s probably why your test looked so good.

---

# How to preserve ~1m accuracy

You need **controlled quantization**.

Example design:

Option A (safe)

```
0.25 m precision
12-bit storage
```

Option B (balanced)

```
0.5 m precision
10-bit storage
```

Option C (aggressive)

```
1 m precision
8–10 bit storage
```

Even option C still beats most global DEM accuracy.

---

# Important: avoid the biggest AVIF pitfall

You must disable:

• chroma subsampling
• color transforms
• tone mapping

Use:

```
4:4:4
monochrome
full-range
high bit depth
```

Otherwise you lose elevation fidelity.

---

# The best architecture (this is likely what you want)

### Custom container format

Something like:

```
OZEN (OpenZenith)

header
tile_index
tile_metadata
compressed_tiles
overlay_layers
```

Each tile:

```
tile_header
base_height
scale
compression_type
codec_params
encoded_data
```

Where encoded_data can be:

• AVIF
• Zstd stream
• raw delta field
• future codec

This makes the system future-proof.

---

# Hybrid compression is where you win big

Instead of relying on one codec:

```
DEM → predictor → residuals → codec
```

Prediction example:

```
predict = average(neighbors)
residual = actual - predict
```

Residuals compress insanely well.

Then encode residual field via:

AVIF or HEIF.

This is how you push toward **95–99% compression** safely.

---

# Realistic compression expectations

Global 30m DEM (~200GB raw):

With your approach:

Conservative:

```
5–15 GB
```

Optimized pipeline:

```
2–6 GB
```

Aggressive:

```
500 MB – 2 GB
```

With minimal accuracy loss.

So your intuition about **500MB–few GB** is actually realistic.

---

# Where HEIF / AVIF shine for this use case

AV1 has advantages most people miss:

1. Intra prediction modes (perfect for terrain)
2. Transform coding
3. Large block sizes
4. Excellent entropy coding

Terrain maps compress **better than photos**.

---

# Where they still struggle

Edge cases:

• cliffs
• cities with LiDAR
• sharp ridges
• noise from merged datasets

These increase entropy.

Solution:
Adaptive encoding per tile.

Your format could select:

```
AVIF
or
ZSTD
or
raw delta
```

Per tile.

That’s powerful.

---

# The real innovation you’re approaching

What you’re describing is essentially:

A **DEM codec**.

Which surprisingly **doesn't really exist yet** in an open standardized way.

Closest things are:

Cesium quantized-mesh terrain.

But that converts to geometry, not raster.

Your approach would be:

More flexible
Better for analytics
Smaller for storage

---

# The hardest technical challenge (not compression)

It’s this:

**vertical datum alignment**

Different datasets use different reference levels.

Example issues:
• ellipsoid vs geoid
• local datums
• survey offsets

If OpenZenith doesn't normalize this, merges will break.

You’ll want:

```
EGM96 or EGM2008 normalized elevations
```

globally.

---

# A surprising advantage of your system

Because tiles are normalized locally:

Future higher-resolution data can be inserted **without rewriting the world dataset**.

This is huge.

Most DEM datasets cannot do that easily.

---

# My honest opinion on the idea

This could actually become a **widely used open dataset** if done right.

Because right now DEM workflows are honestly a mess.

You identified a real gap.

Especially if you provide:

CLI tools
local API server
tile CDN
easy ingestion

---

# If you want maximum compression potential

I would test three pipelines:

Pipeline A

```
DEM → quantize → delta encode → Zstd
```

Pipeline B

```
DEM → normalize → AVIF
```

Pipeline C (likely best)

```
DEM → predictor → residuals → AVIF
```

Pipeline C might produce shocking results.

---

# One more thing your AVIF test might have revealed

Your tile probably contained a **very smooth terrain region**.

Those compress *extremely* well.

Mountain regions will compress less.

But still well.

---

# Final verdict

Yes — your idea is technically viable.

Using:
AVIF/HEIF + custom container + predictive encoding

you can likely achieve:

• Massive compression
• Good precision
• Incremental updates
• Client-side delivery

which is exactly what OpenZenith needs.

---

If you want, I can also outline something useful:

A **first draft specification for the OpenZenith file format**.

That would help validate the idea quickly.
