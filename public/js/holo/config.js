// The look of the hologram: every tunable number lives here.
// Units: world units, where the mass radius is ~1. Values marked (rebuild)
// only take effect when the geometry is regenerated.
//
// From the Holo Core project (github/Ultron), without its voice and model
// settings: ARIA has its own.

// Filled in from ARIA's theme before each build (index.js: themePalette), so
// the hologram is the accent colour. The keys keep their Holo Core names:
// hot = the white-hot centre, cyan = the light mid tone, electric = the
// accent itself, deep = its dark edge.
export const PALETTE = {
  background: '#080404',
  deep: '#770a04',
  electric: '#f8291c',
  cyan: '#fb7c74',
  hot: '#fef1f0',
};

export const CONFIG = {
  seed: 23, // (rebuild) same seed -> same mass

  renderer: {
    toneMapping: 'None', // None | Neutral | ACES | AgX  (None keeps the accent pure; the soft clip handles highlights)
    exposure: 1.0, // only used when toneMapping is not None
    brightness: 0.55, // master brightness of every hologram layer
    pixelRatioCap: 2, // max devicePixelRatio we render at
    msaaSamples: 4, // MSAA on the main render target; smooths 1px lines
    depthCue: 0.55, // near parts brighter, far parts dimmer (0 = flat)
    hdrClamp: 1.6, // soft ceiling on summed brightness before bloom (keeps the core from flooding the screen)
  },

  camera: {
    fov: 40,
    near: 0.05,
    far: 100,
    height: 0.35, // camera elevation, looking slightly down at the core
    fitMargin: 1.35, // start view fits the whole hologram (mass + fragments) times this; higher = further out
    minDistance: 2,
    maxDistance: 30,
    damping: 0.06,
  },

  mass: {
    radius: 1.4, // (rebuild) base radius of the mass; everything else scales with it
    rotationPeriod: 50, // seconds per full revolution
    radialBias: 0.42, // (rebuild) <0.333 = hollow, 0.333 = uniform volume, higher = denser core
    lumpAmp: 0.32, // (rebuild) how lumpy the outline is (fraction of radius)
    lumpFreq: 1.5, // (rebuild) size of the lumps (higher = more, smaller lumps)
    warpAmp: 0.16, // (rebuild) domain-warp strength; makes the interior organic
    warpFreq: 2.2, // (rebuild)
    strayFraction: 0.035, // (rebuild) fraction of nodes flung outside the surface (ragged edge)
    strayReach: 0.45, // (rebuild) how far strays go past the surface
    lopsided: 0.2, // (rebuild) bulges the outline toward one side and shrinks the other (0 = even)
  },

  nodes: {
    count: 5000, // (rebuild)
    size: 3.0, // point size in CSS px at distance ~3
    opacity: 0.55,
    twinkleSpeed: 1.6,
  },

  network: {
    kMin: 3, // (rebuild) each node links to between kMin and kMax nearest neighbours
    kMax: 5, // (rebuild)
    maxEdgeFactor: 2.7, // (rebuild) max edge length = factor * mean node spacing
    subdivisions: 4, // (rebuild) sub-segments per edge (1 = straight lines)
    curvature: 0.3, // (rebuild) sideways bow of each edge, fraction of its length
    jitter: 0.035, // (rebuild) per-vertex lightning jitter, fraction of edge length
    opacity: 0.2, // base line opacity; other line layers are set relative to this
    brightnessMin: 0.35, // (rebuild) per-filament random brightness range
    brightnessMax: 1.25, // (rebuild)
    flickerAmount: 0.18, // per-filament shimmer depth
    flickerSpeed: 2.5,
    pulseAmount: 2.5, // brightness boost of the energy pulses running along filaments
    pulseSpeed: 0.35, // pulse trips per second along a filament
    pulseWidth: 0.12, // pulse length, as a fraction of the filament
    pulseFraction: 0.06, // share of filaments carrying a pulse at any moment
  },

  // Crumpled translucent membranes at the heart of the mass (the inner "bloom").
  petals: {
    count: 15, // (rebuild)
    rings: 16, // (rebuild) mesh resolution from centre to edge of each petal
    spokes: 96, // (rebuild) mesh resolution around each petal
    radiusMin: 0.25, // (rebuild) petal shell radius, in mass radii
    radiusMax: 0.75, // (rebuild)
    extentMin: 1.0, // (rebuild) angular size of a petal, radians
    extentMax: 1.7, // (rebuild)
    raggedness: 0.3, // (rebuild) how torn the petal outline is
    crumple: 0.11, // (rebuild) fold depth, in mass radii
    crumpleFreq: 1.8, // (rebuild) fold density
    curl: 0.5, // (rebuild) how much petal edges flare outward
    faceOpacity: 0.012, // faint fill of each membrane
    fresnel: 0.24, // glow where membranes turn edge-on (lights the folds)
    fresnelPower: 6.0, // higher = thinner, crisper fold highlights
    rim: 0.25, // glow band along each petal's border
    rimStart: 0.82, // where the border band starts (0 = centre, 1 = edge)
    outlineOpacity: 2.6, // (rebuild) crisp 1px petal outlines, relative to filament opacity
    outlineBrightness: 2.2, // (rebuild)
  },

  // Bright lightning veins radiating from the centre through the petals.
  veins: {
    count: 9, // (rebuild) main bolts
    reachMin: 0.5, // (rebuild) bolt length, in mass radii
    reachMax: 0.8, // (rebuild)
    depth: 5, // (rebuild) midpoint-displacement passes (2^depth segments)
    roughness: 0.09, // (rebuild) how jagged the bolts are
    branchChance: 0.75, // (rebuild) chance each bolt forks
    brightness: 2.4, // (rebuild)
    opacity: 4.0, // relative to filament opacity
    pulseScale: 1.6, // pulse strength relative to network.pulseAmount
    flashAmount: 3.0, // brightness of the occasional whole-bolt flash
    flashRate: 0.6, // flash checks per second per bolt (each has a ~12% chance)
  },

  // Blown-out white hotspot at the very centre, with faint rays.
  flare: {
    size: 0.35, // in mass radii
    intensity: 0.6,
    rays: 14, // (rebuild)
    pulseAmount: 0.12,
    pulseSpeed: 1.1,
  },

  // Small detached fragments floating beside the main mass, tied to it by lightning strands.
  satellites: {
    seed: 4, // (rebuild) layout seed for the fragments, separate from the main seed
    count: 9, // (rebuild)
    nodesMin: 350, // (rebuild) filament nodes per fragment (the dashes are the main fill)
    nodesMax: 650, // (rebuild)
    radiusMin: 0.52, // (rebuild) fragment size in mass radii, before stretching
    radiusMax: 0.62, // (rebuild)
    distanceMin: 1.6, // (rebuild) distance from centre, in mass radii
    distanceMax: 2.3, // (rebuild)
    elevationMin: -0.9, // (rebuild) height range, in mass radii
    elevationMax: 0.9, // (rebuild)
    stretchMin: 1.0, // (rebuild) how far each shell wraps along the orbit
    stretchMax: 1.4, // (rebuild)
    flattenMin: 1.2, // (rebuild) vertical extent of the shell
    flattenMax: 1.8, // (rebuild)
    thicknessMin: 0.8, // (rebuild) radial thickness (low = thin curved sheet facing the core)
    thicknessMax: 1.8, // (rebuild)
    bendRadius: 1.4, // (rebuild) shell curvature radius as a fraction of its distance; 1 = hugs its orbit, lower = curls tighter
    lean: 0.4, // (rebuild) how far each blade sweeps sideways as it reaches outward (tan of the lean angle)
    taper: 0.35, // (rebuild) 0 = even blades; higher = one end reaches further out than the other
    flare: 0.45, // (rebuild) widens each blade toward its outer edge, like a fan
    tiltMax: 1.1, // (rebuild) random tilt around the core, radians
    orbitTilt: 0.6, // tilts the whole orbit toward the camera so fragments ring the core (0 = edge-on, 1.57 = face-on)
    asymmetry: 0.15, // (rebuild) 0 = evenly spaced around the core, 1 = bunched into clusters with gaps
    clusters: 3, // (rebuild) how many groups the fragments bunch into
    clusterSpread: 0.55, // (rebuild) angular spread within a cluster, radians
    sizeSkew: 1.3, // (rebuild) >1 makes most fragments small and a few large
    heroCount: 2, // (rebuild) number of oversized fragments
    heroScale: 1.45, // (rebuild) size multiplier for those
    outlierCount: 1, // (rebuild) small chunks that float further out than the rest
    outlierScale: 0.75, // (rebuild) their size multiplier
    outlierDistance: 1.3, // (rebuild) their distance multiplier
    radialBias: 0.3, // (rebuild) density profile of a fragment (low = wispy, even)
    lumpAmp: 0.7, // (rebuild)
    strayFraction: 0.02, // (rebuild) ragged bits around each fragment
    rampShift: 0.1, // (rebuild) >0 skips the hot-white centre colour, so fragments stay the accent colour
    brightness: 2.5, // (rebuild)
    strandsPerSatellite: 3, // (rebuild) lightning strands linking each fragment to the core
    strandDepth: 6, // (rebuild) midpoint-displacement passes (2^depth segments)
    strandRoughness: 0.05, // (rebuild) how jagged the strands are
    branchChance: 0.6, // (rebuild) chance a strand forks
    strandOpacity: 2.6, // strand opacity relative to filament opacity
    strandPulseScale: 2.0, // pulses running from the core out to each fragment
    anchorsPerSatellite: 3, // (rebuild) extra plexus junctions on each fragment (its tip and inner end are always used)
    dashRowSpacing: 0.05, // (rebuild) gap between dash rows, in fragment radii
    dashMin: 0.06, // (rebuild) dash length range, in fragment radii
    dashMax: 0.26, // (rebuild)
    gapMin: 0.03, // (rebuild) gap between dashes in a row
    gapMax: 0.16, // (rebuild)
    dashFill: 0.55, // (rebuild) chance each dash slot is filled
    dashThickness: 0.012, // (rebuild) offset of the doubled line that thickens each dash
    dashBrightness: 2.2, // (rebuild)
    dashOpacity: 2.2, // dash opacity relative to filament opacity
    orbitPeriod: 120, // seconds per orbit around the core
    swayAmp: 0.03, // radians each shell drifts back and forth along its orbit
    swaySpeed: 0.25,
    bobAmp: 0.035, // vertical bob, in mass radii
    bobSpeed: 0.4,
  },

  // Sparse straight-line web with bright junctions, between the core and the fragments.
  web: {
    coreCount: 24, // (rebuild) junctions on the core's outline
    coreRadius: 1.1, // (rebuild) in mass radii
    bandCount: 45, // (rebuild) junctions in the loose band wrapping the outside
    bandInner: 1.6, // (rebuild) band radius range, in mass radii
    bandOuter: 3.2, // (rebuild)
    bandHeight: 1.8, // (rebuild) band thickness across the orbit plane, in mass radii
    kMin: 1, // (rebuild) links per junction
    kMax: 2, // (rebuild)
    minEdge: 1.0, // (rebuild) shortest link, in mass radii (keeps the lines long)
    maxEdge: 2.6, // (rebuild) longest link
    curve: 0.18, // (rebuild) sideways bow of each link, as a fraction of its length (0 = straight)
    color: '#770a04', // (rebuild) set from the theme: the accent's dark edge, darker than the filaments
    brightness: 1.2, // (rebuild)
    dotBrightness: 1.6, // (rebuild) junction dots
    opacity: 1.4, // relative to filament opacity
    pulseScale: 0.6, // pulse strength relative to network.pulseAmount
  },

  // Radial colour ramp, by distance from centre / radius. Brightness falls off with it.
  colorRamp: {
    hotEnd: 0.04, // pure hot white inside this
    cyanAt: 0.45,
    electricAt: 0.85,
    deepAt: 1.1,
    brightnessCore: 0.42, // kept low so the petals read through the centre // brightness multiplier at the centre
    brightnessEdge: 0.5, // brightness multiplier at r >= deepAt
  },

  // Movie-frame finish, applied after everything else.
  film: {
    aberration: 0.0008, // RGB split, strongest toward the screen edges
    vignette: 0.22, // darkening toward the corners
    grain: 0.1, // animated film grain (scaled by brightness, so black stays black)
  },

  // Tiny drifting specks of light around the whole hologram.
  dust: {
    count: 1600, // (rebuild)
    coreShare: 0.3, // (rebuild) share scattered over the core
    fragmentShare: 0.5, // (rebuild) share scattered through the fragments (the rest float loose)
    jitter: 0.06, // (rebuild) how far a glint sits from the node it's scattered around, in mass radii
    radiusMin: 1.0, // (rebuild) loose glints: shell range, in mass radii
    radiusMax: 2.4, // (rebuild)
    brightness: 4.0, // (rebuild)
    heroFraction: 0.05, // (rebuild) share of glints that flare 3x brighter
    size: 2.2, // point size, like nodes.size
    opacity: 1.0,
    drift: 0.08, // how far each speck wanders, in mass radii
    driftSpeed: 0.15,
    twinkleSpeed: 1.2,
  },

  bloom: {
    threshold: 0.4,
    strength: 0.38,
    radius: 0.05, // low keeps the glow tight instead of hazing the background
    resolutionScale: 0.75, // bloom buffer size relative to the screen
  },
};
