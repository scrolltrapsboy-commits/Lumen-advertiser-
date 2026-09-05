/*
 * turbulent-dissolve.js
 *
 * BIG DISPLAY VIDEO-INCLUSIVE TRANSITION
 *
 * Supported:
 *   IMAGE -> VIDEO
 *   VIDEO -> IMAGE
 *   VIDEO -> VIDEO
 *
 * Effect:
 *   Large soft organic / amoeba dissolve.
 *
 * NOT:
 *   - BAS
 *   - particle fragments
 *   - triangle transition
 *   - zoom
 *   - opacity crossfade
 *
 * IMPORTANT FLOW:
 *
 *   OLD AD 100%
 *        ↓
 *   organic mask begins
 *        ↓
 *   OLD + NEW coexist in WebGL
 *        ↓
 *   blobs grow and merge
 *        ↓
 *   NEW AD 100%
 *        ↓
 *   WebGL surface removed
 *        ↓
 *   DOM layer swapped
 *
 * The incoming DOM layer is NEVER displayed over
 * the outgoing DOM layer during the dissolve.
 */


/* ============================================================
 * CONFIGURATION
 * ============================================================ */

/*
 * Slightly slower premium timing.
 *
 * Change ONLY this value if you ever want to tune speed.
 */
const DEFAULT_DURATION = 1800;

/*
 * Low-frequency noise.
 *
 * Large values here would create small/grainy blobs.
 */
const NOISE_SCALE = 2.15;

/*
 * Domain warp.
 */
const WARP_SCALE = 1.10;
const WARP_STRENGTH = 0.48;

/*
 * Two octave noise.
 */
const OCTAVE_1_WEIGHT = 0.78;
const OCTAVE_2_WEIGHT = 0.22;

/*
 * Soft organic edge.
 */
const EDGE_SOFTNESS = 0.075;


/* ============================================================
 * TRANSITION SERIALIZATION
 * ============================================================ */

let transitionQueue = Promise.resolve();

const contexts = new WeakMap();


/* ============================================================
 * VERTEX SHADER
 * ============================================================ */

const VERTEX_SHADER = `
precision highp float;

attribute vec2 aPosition;

varying vec2 vUV;

void main() {

    vUV =
        aPosition * 0.5 +
        0.5;

    gl_Position =
        vec4(
            aPosition,
            0.0,
            1.0
        );
}
`;


/* ============================================================
 * FRAGMENT SHADER
 * ============================================================ */

const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uOutgoing;
uniform sampler2D uIncoming;

uniform vec4 uOutgoingRect;
uniform vec4 uIncomingRect;

uniform float uProgress;

uniform float uNoiseScale;
uniform float uWarpScale;
uniform float uWarpStrength;
uniform float uEdgeSoftness;

varying vec2 vUV;


/* ============================================================
 * HASH
 * ============================================================ */

float hash21(vec2 p) {

    p =
        fract(
            p *
            vec2(
                123.34,
                456.21
            )
        );

    p +=
        dot(
            p,
            p + 45.32
        );

    return fract(
        p.x * p.y
    );
}


/* ============================================================
 * VALUE NOISE
 * ============================================================ */

float noise(vec2 p) {

    vec2 i =
        floor(p);

    vec2 f =
        fract(p);

    /*
     * Smooth interpolation.
     */
    f =
        f *
        f *
        (
            3.0 -
            2.0 * f
        );

    float a =
        hash21(i);

    float b =
        hash21(
            i +
            vec2(
                1.0,
                0.0
            )
        );

    float c =
        hash21(
            i +
            vec2(
                0.0,
                1.0
            )
        );

    float d =
        hash21(
            i +
            vec2(
                1.0,
                1.0
            )
        );

    return mix(
        mix(
            a,
            b,
            f.x
        ),
        mix(
            c,
            d,
            f.x
        ),
        f.y
    );
}


/* ============================================================
 * FBM
 * ============================================================ */

float fbm(vec2 p) {

    float value = 0.0;

    value +=
        noise(p) *
        0.78;

    p *= 2.03;

    value +=
        noise(p) *
        0.22;

    return value;
}


/* ============================================================
 * ORGANIC DOMAIN WARP
 * ============================================================ */

float organicNoise(vec2 uv) {

    vec2 p =
        uv *
        uNoiseScale;

    vec2 warp;

    warp.x =
        fbm(
            p *
            uWarpScale +
            vec2(
                4.73,
                1.31
            )
        );

    warp.y =
        fbm(
            p *
            uWarpScale +
            vec2(
                8.21,
                3.71
            )
        );

    /*
     * Convert 0..1 into -1..1.
     */
    warp =
        (
            warp -
            0.5
        ) *
        2.0;

    /*
     * Bend the noise field.
     */
    p +=
        warp *
        uWarpStrength;

    float n =
        fbm(p);

    /*
     * Keep useful noise distributed over
     * the whole screen.
     */
    n =
        smoothstep(
            0.12,
            0.88,
            n
        );

    return n;
}


/* ============================================================
 * CONTAIN RECTANGLE
 * ============================================================ */

vec2 mapToMedia(
    vec2 screenUV,
    vec4 rect
) {

    return (
        screenUV -
        rect.xy
    ) /
    rect.zw;
}


/* ============================================================
 * MEDIA SAMPLE
 * ============================================================ */

vec4 sampleMedia(
    sampler2D tex,
    vec2 screenUV,
    vec4 rect
) {

    vec2 uv =
        mapToMedia(
            screenUV,
            rect
        );

    /*
     * Outside the actual media rectangle
     * return transparent.
     *
     * This prevents stretching.
     */
    if (
        uv.x < 0.0 ||
        uv.x > 1.0 ||
        uv.y < 0.0 ||
        uv.y > 1.0
    ) {

        return vec4(
            0.0,
            0.0,
            0.0,
            0.0
        );
    }

    /*
     * Texture coordinate orientation.
     */
    uv.y =
        1.0 -
        uv.y;

    return texture2D(
        tex,
        uv
    );
}


/* ============================================================
 * MAIN
 * ============================================================ */

void main() {

    vec2 uv =
        vUV;

    float progress =
        clamp(
            uProgress,
            0.0,
            1.0
        );

    /*
     * Organic field.
     */
    float n =
        organicNoise(uv);

    /*
     * ---------------------------------------------------------
     * TRANSITION MASK
     * ---------------------------------------------------------
     *
     * progress 0:
     *     OLD AD
     *
     * progress 0.5:
     *     large organic regions
     *
     * progress 1:
     *     NEW AD
     *
     * The threshold travels through the noise field.
     */
    float threshold =
        mix(
            -0.08,
            1.08,
            progress
        );

    float incomingAmount =
        1.0 -
        smoothstep(
            threshold -
            uEdgeSoftness,

            threshold +
            uEdgeSoftness,

            n
        );

    /*
     * Extra temporal smoothing.
     *
     * Does NOT scale or zoom the media.
     */
    float mask =
        smoothstep(
            0.0,
            1.0,
            incomingAmount
        );


    /*
     * ---------------------------------------------------------
     * SAMPLE BOTH MEDIA
     * ---------------------------------------------------------
     *
     * This is the critical part.
     *
     * The new DOM layer is NOT displayed.
     *
     * The old and new media are composited here,
     * inside the same WebGL surface.
     */
    vec4 outgoing =
        sampleMedia(
            uOutgoing,
            uv,
            uOutgoingRect
        );

    vec4 incoming =
        sampleMedia(
            uIncoming,
            uv,
            uIncomingRect
        );


    /*
     * Composite.
     */
    vec3 rgb =
        mix(
            outgoing.rgb,
            incoming.rgb,
            mask
        );


    /*
     * Preserve visible media alpha.
     */
    float alpha =
        max(
            outgoing.a,
            incoming.a
        );


    /*
     * Outside both contain rectangles:
     *
     * keep transparent so the existing display
     * background remains visible.
     */
    if (
        outgoing.a < 0.001 &&
        incoming.a < 0.001
    ) {

        rgb =
            vec3(
                0.0
            );

        alpha =
            0.0;
    }

    gl_FragColor =
        vec4(
            rgb,
            alpha
        );
}
`;


/* ============================================================
 * MEDIA LOOKUP
 * ============================================================ */

function findMediaElement(layer) {

    if (!layer) {
        return null;
    }

    /*
     * Prefer the foreground media.
     */
    const foreground =
        layer.querySelector(
            ".player-foreground-media"
        );

    if (foreground) {
        return foreground;
    }

    /*
     * Fallback for existing markup.
     */
    return layer.querySelector(
        "video, img"
    );
}


/* ============================================================
 * MEDIA DIMENSIONS
 * ============================================================ */

function getMediaSize(media) {

    if (!media) {

        return {
            width: 16,
            height: 9
        };
    }

    if (
        media.tagName ===
        "VIDEO"
    ) {

        return {
            width:
                media.videoWidth ||
                16,

            height:
                media.videoHeight ||
                9
        };
    }

    return {
        width:
            media.naturalWidth ||
            16,

        height:
            media.naturalHeight ||
            9
    };
}


/* ============================================================
 * CONTAIN FIT
 * ============================================================ */

function getContainRect(
    mediaWidth,
    mediaHeight,
    viewportWidth,
    viewportHeight
) {

    mediaWidth =
        Math.max(
            1,
            mediaWidth || 1
        );

    mediaHeight =
        Math.max(
            1,
            mediaHeight || 1
        );

    viewportWidth =
        Math.max(
            1,
            viewportWidth || 1
        );

    viewportHeight =
        Math.max(
            1,
            viewportHeight || 1
        );

    const mediaAspect =
        mediaWidth /
        mediaHeight;

    const viewportAspect =
        viewportWidth /
        viewportHeight;

    let width;
    let height;

    if (
        mediaAspect >
        viewportAspect
    ) {

        /*
         * Landscape media.
         */
        width =
            viewportWidth;

        height =
            viewportWidth /
            mediaAspect;

    } else {

        /*
         * Portrait / tall media.
         */
        height =
            viewportHeight;

        width =
            viewportHeight *
            mediaAspect;
    }

    const x =
        (
            viewportWidth -
            width
        ) *
        0.5;

    const y =
        (
            viewportHeight -
            height
        ) *
        0.5;

    /*
     * x, y, width, height
     * normalized to 0..1.
     */
    return [
        x / viewportWidth,
        y / viewportHeight,
        width / viewportWidth,
        height / viewportHeight
    ];
}


/* ============================================================
 * MEDIA READY
 * ============================================================ */

function isImageReady(image) {

    return !!(
        image &&
        image.tagName === "IMG" &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
    );
}


function isVideoReady(video) {

    return !!(
        video &&
        video.tagName === "VIDEO" &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
    );
}


function isMediaReady(media) {

    if (!media) {
        return false;
    }

    if (
        media.tagName ===
        "VIDEO"
    ) {

        return isVideoReady(
            media
        );
    }

    return isImageReady(
        media
    );
}


/* ============================================================
 * WAIT IMAGE
 * ============================================================ */

async function waitForImage(
    image,
    timeout = 4000
) {

    if (!image) {
        return false;
    }

    if (
        isImageReady(
            image
        )
    ) {

        /*
         * decode() confirms the image is actually
         * paintable.
         */
        if (
            typeof image.decode ===
            "function"
        ) {

            try {
                await image.decode();
            } catch (_) {
                /*
                 * naturalWidth/naturalHeight are
                 * still authoritative here.
                 */
            }
        }

        return isImageReady(
            image
        );
    }

    return new Promise(
        resolve => {

            let finished =
                false;

            const finish =
                value => {

                    if (finished) {
                        return;
                    }

                    finished =
                        true;

                    image.removeEventListener(
                        "load",
                        onLoad
                    );

                    image.removeEventListener(
                        "error",
                        onError
                    );

                    resolve(
                        value
                    );
                };

            const onLoad =
                async () => {

                    if (
                        typeof image.decode ===
                        "function"
                    ) {

                        try {
                            await image.decode();
                        } catch (_) {}
                    }

                    finish(
                        isImageReady(
                            image
                        )
                    );
                };

            const onError =
                () => {

                    finish(
                        false
                    );
                };

            image.addEventListener(
                "load",
                onLoad
            );

            image.addEventListener(
                "error",
                onError
            );

            setTimeout(
                () => {

                    finish(
                        isImageReady(
                            image
                        )
                    );

                },
                timeout
            );
        }
    );
}


/* ============================================================
 * WAIT VIDEO
 * ============================================================ */

async function waitForVideo(
    video,
    timeout = 5000
) {

    if (!video) {
        return false;
    }

    /*
     * Already has a usable frame.
     */
    if (
        isVideoReady(
            video
        )
    ) {

        /*
         * Give the browser one frame boundary
         * so WebGL never receives an empty first
         * frame on a newly loaded video.
         */
        if (
            typeof video.requestVideoFrameCallback ===
            "function"
        ) {

            await new Promise(
                resolve => {

                    let done =
                        false;

                    const finish =
                        () => {

                            if (done) {
                                return;
                            }

                            done =
                                true;

                            resolve();
                        };

                    try {

                        video.requestVideoFrameCallback(
                            finish
                        );

                    } catch (_) {

                        finish();
                    }

                    setTimeout(
                        finish,
                        500
                    );
                }
            );
        }

        return isVideoReady(
            video
        );
    }


    /*
     * Wait for metadata/frame.
     */
    return new Promise(
        resolve => {

            let finished =
                false;

            const finish =
                value => {

                    if (finished) {
                        return;
                    }

                    finished =
                        true;

                    video.removeEventListener(
                        "loadedmetadata",
                        onReady
                    );

                    video.removeEventListener(
                        "loadeddata",
                        onReady
                    );

                    video.removeEventListener(
                        "canplay",
                        onReady
                    );

                    video.removeEventListener(
                        "error",
                        onError
                    );

                    resolve(
                        value
                    );
                };

            const onReady =
                () => {

                    if (
                        isVideoReady(
                            video
                        )
                    ) {

                        finish(
                            true
                        );
                    }
                };

            const onError =
                () => {

                    finish(
                        false
                    );
                };

            video.addEventListener(
                "loadedmetadata",
                onReady
            );

            video.addEventListener(
                "loadeddata",
                onReady
            );

            video.addEventListener(
                "canplay",
                onReady
            );

            video.addEventListener(
                "error",
                onError
            );

            setTimeout(
                () => {

                    finish(
                        isVideoReady(
                            video
                        )
                    );

                },
                timeout
            );

            /*
             * Check immediately in case the
             * event already fired.
             */
            onReady();
        }
    );
}


/* ============================================================
 * WAIT ANY MEDIA
 * ============================================================ */

async function waitForMedia(
    media
) {

    if (!media) {
        return false;
    }

    if (
        media.tagName ===
        "VIDEO"
    ) {

        return waitForVideo(
            media
        );
    }

    return waitForImage(
        media
    );
}


/* ============================================================
 * CANVAS
 * ============================================================ */

function getCanvas(
    container
) {

    let canvas =
        container.querySelector(
            "canvas[data-turbulent-dissolve]"
        );

    if (!canvas) {

        canvas =
            document.createElement(
                "canvas"
            );

        canvas.dataset
            .turbulentDissolve =
            "true";

        container.appendChild(
            canvas
        );
    }

    Object.assign(
        canvas.style,
        {
            position:
                "absolute",

            inset:
                "0",

            width:
                "100%",

            height:
                "100%",

            display:
                "none",

            visibility:
                "hidden",

            pointerEvents:
                "none",

            zIndex:
                "999999",

            opacity:
                "0"
        }
    );

    return canvas;
}


/* ============================================================
 * SHADER COMPILATION
 * ============================================================ */

function compileShader(
    gl,
    type,
    source
) {

    const shader =
        gl.createShader(
            type
        );

    if (!shader) {

        throw new Error(
            "Turbulent dissolve: shader creation failed."
        );
    }

    gl.shaderSource(
        shader,
        source
    );

    gl.compileShader(
        shader
    );

    if (
        !gl.getShaderParameter(
            shader,
            gl.COMPILE_STATUS
        )
    ) {

        const error =
            gl.getShaderInfoLog(
                shader
            ) ||
            "Unknown shader compilation error.";

        gl.deleteShader(
            shader
        );

        throw new Error(
            "Turbulent dissolve shader error: " +
            error
        );
    }

    return shader;
}


/* ============================================================
 * PROGRAM
 * ============================================================ */

function createProgram(
    gl
) {

    const vertex =
        compileShader(
            gl,
            gl.VERTEX_SHADER,
            VERTEX_SHADER
        );

    const fragment =
        compileShader(
            gl,
            gl.FRAGMENT_SHADER,
            FRAGMENT_SHADER
        );

    const program =
        gl.createProgram();

    if (!program) {

        gl.deleteShader(
            vertex
        );

        gl.deleteShader(
            fragment
        );

        throw new Error(
            "Turbulent dissolve: program creation failed."
        );
    }

    gl.attachShader(
        program,
        vertex
    );

    gl.attachShader(
        program,
        fragment
    );

    gl.linkProgram(
        program
    );

    gl.deleteShader(
        vertex
    );

    gl.deleteShader(
        fragment
    );

    if (
        !gl.getProgramParameter(
            program,
            gl.LINK_STATUS
        )
    ) {

        const error =
            gl.getProgramInfoLog(
                program
            ) ||
            "Unknown program linking error.";

        gl.deleteProgram(
            program
        );

        throw new Error(
            "Turbulent dissolve program error: " +
            error
        );
    }

    return program;
}


/* ============================================================
 * WEBGL INITIALIZATION
 * ============================================================ */

function initializeWebGL(
    canvas
) {

    const existing =
        contexts.get(
            canvas
        );

    if (
        existing &&
        existing.gl &&
        !existing.gl.isContextLost()
    ) {

        return existing;
    }

    const gl =
        canvas.getContext(
            "webgl",
            {
                alpha:
                    true,

                antialias:
                    true,

                premultipliedAlpha:
                    true,

                preserveDrawingBuffer:
                    false
            }
        );

    if (!gl) {

        throw new Error(
            "Turbulent dissolve: WebGL is not available."
        );
    }

    const program =
        createProgram(
            gl
        );

    const positionLocation =
        gl.getAttribLocation(
            program,
            "aPosition"
        );

    const locations = {

        outgoing:
            gl.getUniformLocation(
                program,
                "uOutgoing"
            ),

        incoming:
            gl.getUniformLocation(
                program,
                "uIncoming"
            ),

        outgoingRect:
            gl.getUniformLocation(
                program,
                "uOutgoingRect"
            ),

        incomingRect:
            gl.getUniformLocation(
                program,
                "uIncomingRect"
            ),

        progress:
            gl.getUniformLocation(
                program,
                "uProgress"
            ),

        noiseScale:
            gl.getUniformLocation(
                program,
                "uNoiseScale"
            ),

        warpScale:
            gl.getUniformLocation(
                program,
                "uWarpScale"
            ),

        warpStrength:
            gl.getUniformLocation(
                program,
                "uWarpStrength"
            ),

        edgeSoftness:
            gl.getUniformLocation(
                program,
                "uEdgeSoftness"
            )
    };


    /*
     * Fullscreen surface.
     *
     * These are ONLY the two triangles required
     * to run the fragment shader.
     *
     * They are NOT the visual transition pieces.
     */
    const quad =
        new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,

            -1,  1,
             1, -1,
             1,  1
        ]);


    const buffer =
        gl.createBuffer();

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        buffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        quad,
        gl.STATIC_DRAW
    );


    const outgoingTexture =
        createTexture(
            gl
        );

    const incomingTexture =
        createTexture(
            gl
        );


    const state = {

        gl,

        program,

        positionLocation,

        locations,

        buffer,

        outgoingTexture,

        incomingTexture
    };


    contexts.set(
        canvas,
        state
    );

    return state;
}


/* ============================================================
 * TEXTURE
 * ============================================================ */

/* ============================================================
 * IMAGE ORIENTATION NORMALIZATION
 * ============================================================
 *
 * CONFIRMED ROOT CAUSE of "incoming ad appears rotated/upside-down
 * during the transition, then looks correct again once the transition
 * ends" (reproduced against the uploaded recording: the architecture-
 * flow infographic renders upside-down mid-dissolve, then right-side-up
 * the instant the DOM takes over):
 *
 * Some source images carry an EXIF Orientation tag (common for photos
 * exported from phones/design tools) instead of having their pixels
 * physically rotated. A plain <img> - and this project's own
 * non-transition rendering - honors that tag automatically, so the
 * DOM always displays it correctly. gl.texImage2D(..., imgElement),
 * however, is NOT guaranteed to honor EXIF orientation across browsers -
 * it can upload the raw, un-rotated pixel buffer. The manual
 * `uv.y = 1.0 - uv.y` flip in the fragment shader (see sampleMedia())
 * is unrelated and correct on its own; this is a separate, orthogonal
 * issue only affecting images whose file actually carries a rotation
 * tag, which is why most media in the recordings look fine and only
 * specific images don't.
 *
 * Fix: for <img> sources only, draw the image onto an offscreen 2D
 * canvas first (Canvas2D's drawImage() DOES honor EXIF orientation,
 * same as normal <img> display) and upload THAT canvas to WebGL
 * instead of the raw <img> element. This guarantees the WebGL texture
 * always matches what the DOM would show, for every image, regardless
 * of its embedded orientation metadata. Videos are untouched - browsers
 * apply any rotation matrix from video containers during decode itself,
 * before texImage2D ever sees a frame, so this class of bug does not
 * apply to <video>.
 */
function getOrientationSafeImageSource(img) {
    if (!img || img.tagName !== 'IMG') return img;
    const cacheKey = img.currentSrc || img.src;
    if (
        img._twdNormalized &&
        img._twdNormalizedKey === cacheKey &&
        img._twdNormalized.width === (img.naturalWidth || img._twdNormalized.width)
    ) {
        return img._twdNormalized;
    }
    try {
        const w = img.naturalWidth || 1;
        const h = img.naturalHeight || 1;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        img._twdNormalized = canvas;
        img._twdNormalizedKey = cacheKey;
        return canvas;
    } catch (err) {
        // Same-origin guarantee is already documented in display.js
        // (prepareMediaElement() deliberately never sets crossOrigin),
        // so this draw should never actually throw a tainted-canvas
        // SecurityError - but if it somehow does, fall back to the raw
        // element rather than breaking the whole transition.
        return img;
    }
}


function createTexture(
    gl
) {

    const texture =
        gl.createTexture();

    if (!texture) {

        throw new Error(
            "Turbulent dissolve: texture creation failed."
        );
    }

    gl.bindTexture(
        gl.TEXTURE_2D,
        texture
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_S,
        gl.CLAMP_TO_EDGE
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_T,
        gl.CLAMP_TO_EDGE
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR
    );

    gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MAG_FILTER,
        gl.LINEAR
    );


    /*
     * Safe initial pixel.
     *
     * This is never displayed because media readiness
     * is checked before the transition starts.
     */
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([
            0,
            0,
            0,
            255
        ])
    );

    return texture;
}


/* ============================================================
 * UPLOAD MEDIA
 * ============================================================ */

function uploadMediaTexture(
    gl,
    texture,
    media
) {

    if (
        !media ||
        !isMediaReady(
            media
        )
    ) {

        return false;
    }

    try {

        gl.bindTexture(
            gl.TEXTURE_2D,
            texture
        );

        /*
         * Do not flip here.
         * The shader handles Y orientation.
         */
        gl.pixelStorei(
            gl.UNPACK_FLIP_Y_WEBGL,
            false
        );

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            getOrientationSafeImageSource(media)
        );

        return true;

    } catch (error) {

        console.warn(
            "[TURBULENT DISSOLVE] Media texture upload failed:",
            error
        );

        return false;
    }
}


/* ============================================================
 * RESIZE
 * ============================================================ */

function resizeCanvas(
    canvas,
    container
) {

    const rect =
        container.getBoundingClientRect();

    const width =
        Math.max(
            1,
            Math.round(
                rect.width
            )
        );

    const height =
        Math.max(
            1,
            Math.round(
                rect.height
            )
        );

    const dpr =
        Math.min(
            2,
            window.devicePixelRatio ||
            1
        );

    canvas.width =
        Math.max(
            1,
            Math.round(
                width *
                dpr
            )
        );

    canvas.height =
        Math.max(
            1,
            Math.round(
                height *
                dpr
            )
        );

    canvas.style.width =
        `${width}px`;

    canvas.style.height =
        `${height}px`;

    return {
        width,
        height,
        dpr
    };
}


/* ============================================================
 * DOM LAYER HELPERS
 * ============================================================ */

function hideLayer(
    layer
) {

    if (!layer) {
        return;
    }

    layer.classList.remove(
        "active"
    );

    layer.style.visibility =
        "hidden";

    layer.style.opacity =
        "0";

    layer.style.pointerEvents =
        "none";

    layer.style.zIndex =
        "-1";
}


function showLayer(
    layer
) {

    if (!layer) {
        return;
    }

    /*
     * Remove animation CSS interference.
     */
    layer.classList.add(
        "no-anim"
    );

    layer.classList.add(
        "active"
    );

    layer.style.visibility =
        "visible";

    layer.style.opacity =
        "1";

    layer.style.pointerEvents =
        "";

    layer.style.zIndex =
        "";

    /*
     * Force browser to commit the state.
     */
    void layer.offsetWidth;

    layer.classList.remove(
        "no-anim"
    );
}


function stopVideoAudio(
    layer
) {

    if (!layer) {
        return;
    }

    layer
        .querySelectorAll(
            "video"
        )
        .forEach(
            video => {

                try {

                    video.muted =
                        true;

                    video.pause();

                } catch (_) {}
            }
        );
}


/* ============================================================
 * INCOMING VIDEO START
 * ============================================================ */

function prepareIncomingVideo(
    video
) {

    if (
        !video ||
        video.tagName !==
        "VIDEO"
    ) {

        return;
    }

    /*
     * Keep it completely invisible because
     * WebGL is displaying it during the transition.
     */
    video.style.visibility =
        "hidden";

    video.style.opacity =
        "0";

    /*
     * Reset to the beginning when possible.
     */
    try {

        if (
            Number.isFinite(
                video.currentTime
            )
        ) {

            video.currentTime =
                0;
        }

    } catch (_) {}


    /*
     * Start muted first.
     *
     * This guarantees the browser can actually
     * provide live video frames even when autoplay
     * policy rejects unmuted playback.
     */
    try {

        video.muted =
            true;

        video.volume =
            1;

        const playPromise =
            video.play();

        if (
            playPromise &&
            typeof playPromise.catch ===
            "function"
        ) {

            playPromise.catch(
                () => {}
            );
        }

    } catch (_) {}
}


/* ============================================================
 * RESTORE INCOMING VIDEO
 * ============================================================ */

async function activateIncomingVideo(
    video
) {

    if (
        !video ||
        video.tagName !==
        "VIDEO"
    ) {

        return;
    }

    /*
     * It is now safe for the DOM layer to become
     * visible because the transition is already over.
     */
    video.style.visibility =
        "";

    video.style.opacity =
        "";


    /*
     * Try unmuted playback.
     */
    try {

        video.muted =
            false;

        const promise =
            video.play();

        if (
            promise &&
            typeof promise.then ===
            "function"
        ) {

            await promise;

        }

        return;

    } catch (_) {}


    /*
     * Browser blocked unmuted autoplay.
     *
     * Continue muted rather than breaking the display.
     */
    try {

        video.muted =
            true;

        const promise =
            video.play();

        if (
            promise &&
            typeof promise.catch ===
            "function"
        ) {

            promise.catch(
                () => {}
            );
        }

    } catch (_) {}
}


/* ============================================================
 * DRAW
 * ============================================================ */

function drawFrame(
    state,
    canvas,
    mediaOut,
    mediaIn,
    outRect,
    inRect,
    progress
) {

    const gl =
        state.gl;

    gl.viewport(
        0,
        0,
        canvas.width,
        canvas.height
    );

    gl.useProgram(
        state.program
    );


    /*
     * Fullscreen quad.
     */
    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        state.buffer
    );

    gl.enableVertexAttribArray(
        state.positionLocation
    );

    gl.vertexAttribPointer(
        state.positionLocation,
        2,
        gl.FLOAT,
        false,
        0,
        0
    );


    /*
     * LIVE VIDEO TEXTURES.
     *
     * Each video is uploaded ONCE per animation frame.
     *
     * This fixes the old duplicate upload path.
     */
    if (
        mediaOut &&
        mediaOut.tagName ===
        "VIDEO"
    ) {

        uploadMediaTexture(
            gl,
            state.outgoingTexture,
            mediaOut
        );
    }

    if (
        mediaIn &&
        mediaIn.tagName ===
        "VIDEO"
    ) {

        uploadMediaTexture(
            gl,
            state.incomingTexture,
            mediaIn
        );
    }


    /*
     * Texture unit 0:
     * outgoing.
     */
    gl.activeTexture(
        gl.TEXTURE0
    );

    gl.bindTexture(
        gl.TEXTURE_2D,
        state.outgoingTexture
    );

    gl.uniform1i(
        state.locations.outgoing,
        0
    );


    /*
     * Texture unit 1:
     * incoming.
     */
    gl.activeTexture(
        gl.TEXTURE1
    );

    gl.bindTexture(
        gl.TEXTURE_2D,
        state.incomingTexture
    );

    gl.uniform1i(
        state.locations.incoming,
        1
    );


    /*
     * Independent contain rectangles.
     */
    gl.uniform4f(
        state.locations.outgoingRect,
        outRect[0],
        outRect[1],
        outRect[2],
        outRect[3]
    );

    gl.uniform4f(
        state.locations.incomingRect,
        inRect[0],
        inRect[1],
        inRect[2],
        inRect[3]
    );


    /*
     * Progress.
     */
    gl.uniform1f(
        state.locations.progress,
        Math.max(
            0,
            Math.min(
                1,
                progress
            )
        )
    );


    /*
     * Noise.
     */
    gl.uniform1f(
        state.locations.noiseScale,
        NOISE_SCALE
    );

    gl.uniform1f(
        state.locations.warpScale,
        WARP_SCALE
    );

    gl.uniform1f(
        state.locations.warpStrength,
        WARP_STRENGTH
    );

    gl.uniform1f(
        state.locations.edgeSoftness,
        EDGE_SOFTNESS
    );


    /*
     * Transparent canvas over the outgoing DOM.
     */
    gl.enable(
        gl.BLEND
    );

    gl.blendFunc(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA
    );

    gl.clearColor(
        0,
        0,
        0,
        0
    );

    gl.clear(
        gl.COLOR_BUFFER_BIT
    );


    /*
     * ONE fullscreen draw.
     *
     * Both media participate in the same frame.
     */
    gl.drawArrays(
        gl.TRIANGLES,
        0,
        6
    );
}


/* ============================================================
 * MAIN TRANSITION
 * ============================================================ */

async function performTransition({
    currentLayer,
    nextLayer,
    durationMs =
        DEFAULT_DURATION,
    dlog = () => {}
}) {

    if (
        !currentLayer ||
        !nextLayer
    ) {

        throw new Error(
            "Turbulent dissolve: invalid transition layers."
        );
    }


    /*
     * =========================================================
     * STEP 1
     * =========================================================
     *
     * HIDE INCOMING DOM FIRST.
     *
     * This is the most important overlap protection.
     */
    hideLayer(
        nextLayer
    );


    /*
     * Find both actual media elements.
     */
    const outgoing =
        findMediaElement(
            currentLayer
        );

    const incoming =
        findMediaElement(
            nextLayer
        );


    if (!outgoing) {

        throw new Error(
            "Turbulent dissolve: outgoing media not found."
        );
    }

    if (!incoming) {

        throw new Error(
            "Turbulent dissolve: incoming media not found."
        );
    }


    /*
     * =========================================================
     * STEP 2
     * =========================================================
     *
     * Silence outgoing video immediately.
     *
     * It remains visually present through WebGL.
     */
    if (
        outgoing.tagName ===
        "VIDEO"
    ) {

        try {

            outgoing.muted =
                true;

        } catch (_) {}
    }


    /*
     * =========================================================
     * STEP 3
     * =========================================================
     *
     * Prepare incoming media while its DOM layer
     * remains hidden.
     */
    if (
        incoming.tagName ===
        "VIDEO"
    ) {

        prepareIncomingVideo(
            incoming
        );
    }


    /*
     * Wait for usable incoming media.
     */
    const incomingReady =
        await waitForMedia(
            incoming
        );


    if (!incomingReady) {

        throw new Error(
            "Turbulent dissolve: incoming media was not ready."
        );
    }


    /*
     * For video, make sure playback is actually running
     * while the DOM is still hidden.
     */
    if (
        incoming.tagName ===
        "VIDEO"
    ) {

        try {

            if (
                !isVideoReady(
                    incoming
                )
            ) {

                await waitForVideo(
                    incoming
                );
            }

            /*
             * HARDENING: prepareIncomingVideo() (called a few lines above,
             * before waitForMedia) already forces muted=true unconditionally,
             * so this is normally already muted by the time we get here.
             * But display.js's prepareMediaElement() calls attemptAudio() -
             * a genuine UNMUTED autoplay attempt - on the incoming video the
             * moment it's constructed, which runs *before* this file's
             * hideLayer/prepareIncomingVideo calls even start. If that
             * unmuted play() resolves in the narrow window between
             * prepareMediaElement() returning and prepareIncomingVideo()
             * running, this used to only re-mute inside an
             * `if (incoming.paused)` guard - which is skipped once the
             * video is already playing, silently leaving `muted` however
             * attemptAudio() last set it. Muting is now unconditional here
             * as well, so there is no code path in this file that can
             * leave the still-hidden incoming video anything but muted.
             * play() is only invoked when it isn't already playing.
             */
            incoming.muted =
                true;

            if (
                incoming.paused
            ) {

                const playPromise =
                    incoming.play();

                if (
                    playPromise &&
                    typeof playPromise.catch ===
                    "function"
                ) {

                    playPromise.catch(
                        () => {}
                    );
                }
            }

        } catch (_) {}
    }


    /*
     * =========================================================
     * STEP 4
     * =========================================================
     *
     * Locate the big-display transition surface.
     */
    const container =
        document.getElementById(
            "bas-canvas-container"
        );


    if (!container) {

        throw new Error(
            "Turbulent dissolve: #bas-canvas-container not found."
        );
    }

    /*
     * FOUND ROOT CAUSE OF "NO VISIBLE TRANSITION":
     *
     * #bas-canvas-container is rendered with
     * class="player-transition-canvas" (see mountPlayerShell() in
     * display.js). pages.css defines:
     *
     *   .player-transition-canvas       { opacity: 0; ... }
     *   .player-transition-canvas.on    { opacity: 1; }
     *
     * No code anywhere ever added the `.on` class to this container.
     * A parent with CSS opacity:0 renders its ENTIRE subtree invisible
     * regardless of any inline opacity/display/visibility set directly
     * on the <canvas> element inside it - so every WebGL frame this
     * engine drew (first frame, animated frames, final frame) was
     * genuinely rendered and genuinely correct, but was composited at
     * 0% opacity the whole time because of this container, every
     * single run. That produced exactly the reported symptom: the
     * outgoing ad stays on screen for the full duration, nothing
     * visibly changes, and then the DOM handoff at the very end
     * (hideLayer(currentLayer) / showLayer(nextLayer)) looks like an
     * instant hard cut - because visually it was one, the entire
     * dissolve having been invisible.
     *
     * Fix: put the container into its visible ("on") state for the
     * duration of the transition and take it back out afterward.
     */
    container.classList.add(
        "on"
    );


    /*
     * =========================================================
     * STEP 5
     * =========================================================
     *
     * Canvas.
     */
    const canvas =
        getCanvas(
            container
        );


    const size =
        resizeCanvas(
            canvas,
            container
        );


    /*
     * =========================================================
     * STEP 6
     * =========================================================
     *
     * WebGL.
     */
    const state =
        initializeWebGL(
            canvas
        );


    /*
     * =========================================================
     * STEP 7
     * =========================================================
     *
     * Independent contain fitting.
     *
     * This prevents:
     *
     * landscape -> portrait
     * portrait -> landscape
     * video -> portrait image
     * portrait image -> landscape video
     *
     * from stretching.
     */
    const outgoingSize =
        getMediaSize(
            outgoing
        );

    const incomingSize =
        getMediaSize(
            incoming
        );


    const outgoingRect =
        getContainRect(
            outgoingSize.width,
            outgoingSize.height,
            size.width,
            size.height
        );

    const incomingRect =
        getContainRect(
            incomingSize.width,
            incomingSize.height,
            size.width,
            size.height
        );


    /*
     * =========================================================
     * STEP 8
     * =========================================================
     *
     * Upload the initial media.
     */
    uploadMediaTexture(
        state.gl,
        state.outgoingTexture,
        outgoing
    );

    uploadMediaTexture(
        state.gl,
        state.incomingTexture,
        incoming
    );


    /*
     * =========================================================
     * STEP 9
     * =========================================================
     *
     * The old DOM ad stays visible underneath.
     *
     * Incoming DOM remains hidden.
     *
     * Canvas is now the transition surface.
     */
    currentLayer.style.zIndex =
        "1";

    nextLayer.style.zIndex =
        "-1";

    canvas.style.display =
        "block";

    canvas.style.visibility =
        "visible";

    canvas.style.opacity =
        "1";


    /*
     * =========================================================
     * STEP 10
     * =========================================================
     *
     * First frame is ALWAYS 100% outgoing.
     *
     * No flash of incoming ad.
     */
    drawFrame(
        state,
        canvas,
        outgoing,
        incoming,
        outgoingRect,
        incomingRect,
        0
    );


    try {

        dlog(
            "[TURBULENT DISSOLVE] started"
        );

    } catch (_) {}


    /*
     * =========================================================
     * STEP 11
     * =========================================================
     *
     * Animate.
     *
     * Both media are sampled every frame.
     *
     * Incoming DOM is still hidden.
     */
    const duration =
        Math.max(
            1000,
            Number(
                durationMs
            ) ||
            DEFAULT_DURATION
        );


    const start =
        performance.now();


    await new Promise(
        resolve => {

            let finished =
                false;

            const complete =
                () => {

                    if (finished) {
                        return;
                    }

                    finished =
                        true;

                    resolve();
                };


            const animate =
                now => {

                    if (finished) {
                        return;
                    }


                    const elapsed =
                        now -
                        start;


                    const progress =
                        Math.min(
                            1,
                            elapsed /
                            duration
                        );


                    /*
                     * Keep outgoing video live.
                     */
                    if (
                        outgoing &&
                        outgoing.tagName ===
                        "VIDEO" &&
                        isVideoReady(
                            outgoing
                        )
                    ) {

                        uploadMediaTexture(
                            state.gl,
                            state.outgoingTexture,
                            outgoing
                        );
                    }


                    /*
                     * Keep incoming video live.
                     */
                    if (
                        incoming &&
                        incoming.tagName ===
                        "VIDEO" &&
                        isVideoReady(
                            incoming
                        )
                    ) {

                        uploadMediaTexture(
                            state.gl,
                            state.incomingTexture,
                            incoming
                        );
                    }


                    /*
                     * Both media are composited
                     * inside the SAME frame.
                     */
                    drawFrame(
                        state,
                        canvas,
                        outgoing,
                        incoming,
                        outgoingRect,
                        incomingRect,
                        progress
                    );


                    if (
                        progress >= 1
                    ) {

                        complete();

                    } else {

                        requestAnimationFrame(
                            animate
                        );
                    }
                };


            requestAnimationFrame(
                animate
            );
        }
    );


    /*
     * =========================================================
     * STEP 12
     * =========================================================
     *
     * Force the final 100% incoming frame.
     *
     * This prevents a one-frame flash of the old ad
     * during the DOM handoff.
     */
    drawFrame(
        state,
        canvas,
        outgoing,
        incoming,
        outgoingRect,
        incomingRect,
        1
    );


    /*
     * =========================================================
     * STEP 13
     * =========================================================
     *
     * CRITICAL HANDOFF.
     *
     * At this point:
     *
     * WebGL = 100% incoming.
     *
     * Incoming DOM = still hidden.
     *
     * Therefore we can safely perform the DOM swap.
     */
    canvas.style.opacity =
        "0";

    canvas.style.visibility =
        "hidden";

    canvas.style.display =
        "none";

    container.classList.remove(
        "on"
    );


    /*
     * Stop outgoing video ONLY NOW.
     */
    stopVideoAudio(
        currentLayer
    );


    /*
     * Hide old layer.
     */
    hideLayer(
        currentLayer
    );


    /*
     * Reveal incoming layer ONLY AFTER
     * the transition is complete.
     *
     * This is what prevents:
     *
     * "image appearing on top of video"
     */
    showLayer(
        nextLayer
    );


    /*
     * Now the incoming video can become visible
     * and continue normally.
     */
    if (
        incoming.tagName ===
        "VIDEO"
    ) {

        await activateIncomingVideo(
            incoming
        );
    }


    try {

        dlog(
            "[TURBULENT DISSOLVE] complete"
        );

    } catch (_) {}
}


/* ============================================================
 * PUBLIC API
 * ============================================================ */

export function runTurbulentDissolve(
    options = {}
) {

    /*
     * Serialize transitions.
     *
     * If rotation fires twice at nearly the same time,
     * the WebGL canvases cannot fight each other.
     */
    const execute =
        () =>
            performTransition(
                options
            );


    const result =
        transitionQueue.then(
            execute,
            execute
        );


    transitionQueue =
        result.then(
            () => undefined,
            () => undefined
        );


    return result;
}


/*
 * Backward-compatible name.
 */
export const runVideoDissolve =
    runTurbulentDissolve;
