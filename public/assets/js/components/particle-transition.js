/*
 * particle-transition.js
 *
 * IMAGE -> IMAGE ONLY
 *
 * Direct WebGL implementation of:
 * https://codepen.io/erujs/pen/QNoWmO
 *
 * CodePen model:
 * PlaneGeometry(100, 60, 200, 120)
 * separate triangle faces
 * per-vertex delay
 * per-face duration
 * cubic bezier movement
 * easeInOutCubic
 * PerspectiveCamera FOV 80
 * camera Z 60
 * 3 second master animation
 */

const WIDTH = 100;
const HEIGHT = 60;

const SEGMENTS_X = 200;
const SEGMENTS_Y = 120;

const CAMERA_Z = 60;
const CAMERA_FOV = 80;

const MIN_DURATION = 0.8;
const MAX_DURATION = 1.2;
const MAX_DELAY_X = 0.9;
const MAX_DELAY_Y = 0.125;
const STRETCH = 0.11;

const TOTAL_DURATION =
  MAX_DURATION +
  MAX_DELAY_X +
  MAX_DELAY_Y +
  STRETCH;

const DEFAULT_DURATION_MS = 3000;

const FLOATS_PER_VERTEX = 16;
const BYTES_PER_VERTEX =
  FLOATS_PER_VERTEX * 4;

let particleGL = null;

/*
 * Serialize transitions, same as turbulent-dissolve.js's transitionQueue.
 * display.js already guards against firing a second rotation while one
 * is in flight (the per-render `nextTriggered` lock), so in normal
 * operation this engine is never re-entered concurrently. But
 * turbulent-dissolve.js has this queue and this file did not, which
 * meant the two engines had different levels of protection against the
 * same class of problem (two transitions fighting over one shared WebGL
 * canvas/context) despite both requirements calling for the same
 * "no overlapping transition calls" guarantee. Adding the same queue
 * here removes that asymmetry, so a corrupted/duplicate call from any
 * future caller can't stomp on this engine's shared GL state.
 */
let particleTransitionQueue = Promise.resolve();


/* ============================================================
 * BASIC HELPERS
 * ============================================================ */

function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function randFloat(min, max) {
  return (
    min +
    Math.random() *
    (max - min)
  );
}

function randFloatSpread(range) {
  return (
    (Math.random() - 0.5) *
    range
  );
}

function mapLinear(
  value,
  inMin,
  inMax,
  outMin,
  outMax
) {
  if (inMax === inMin) {
    return outMin;
  }

  return (
    outMin +
    (
      (value - inMin) /
      (inMax - inMin)
    ) *
    (outMax - outMin)
  );
}

function easeInOutCubic(t) {
  t = clamp(t, 0, 1);

  if (t < 0.5) {
    return 4 * t * t * t;
  }

  return (
    1 -
    Math.pow(
      -2 * t + 2,
      3
    ) /
    2
  );
}


/* ============================================================
 * IMAGE
 * ============================================================ */

function findImage(layer) {
  if (!layer) {
    return null;
  }

  return layer.querySelector(
    ".player-media-content > img.player-foreground-media, img.player-foreground-media"
  );
}

function imageReady(image) {
  return !!(
    image &&
    image.tagName === "IMG" &&
    image.complete &&
    image.naturalWidth > 0 &&
    image.naturalHeight > 0
  );
}

async function waitForImage(
  image,
  timeoutMs = 5000
) {
  if (!image) {
    return false;
  }

  if (imageReady(image)) {
    try {
      if (
        typeof image.decode ===
        "function"
      ) {
        await image.decode();
      }
    } catch (_) {}

    return imageReady(image);
  }

  return new Promise(resolve => {
    let finished = false;

    const finish = ok => {
      if (finished) {
        return;
      }

      finished = true;

      image.removeEventListener(
        "load",
        onLoad
      );

      image.removeEventListener(
        "error",
        onError
      );

      resolve(ok);
    };

    const onLoad = async () => {
      try {
        if (
          typeof image.decode ===
          "function"
        ) {
          await image.decode();
        }
      } catch (_) {}

      finish(
        imageReady(image)
      );
    };

    const onError = () => {
      finish(false);
    };

    image.addEventListener(
      "load",
      onLoad
    );

    image.addEventListener(
      "error",
      onError
    );

    window.setTimeout(() => {
      finish(
        imageReady(image)
      );
    }, timeoutMs);
  });
}


/* ============================================================
 * CONTAIN
 * ============================================================ */

function getContainRect(
  mediaWidth,
  mediaHeight,
  viewportWidth,
  viewportHeight
) {
  const mw =
    Math.max(
      1,
      mediaWidth || 1
    );

  const mh =
    Math.max(
      1,
      mediaHeight || 1
    );

  const vw =
    Math.max(
      1,
      viewportWidth || 1
    );

  const vh =
    Math.max(
      1,
      viewportHeight || 1
    );

  const mediaAspect =
    mw / mh;

  const viewportAspect =
    vw / vh;

  let width;
  let height;

  if (
    mediaAspect >
    viewportAspect
  ) {
    width = vw;
    height =
      vw / mediaAspect;
  } else {
    height = vh;
    width =
      vh * mediaAspect;
  }

  return {
    x:
      (vw - width) *
      0.5,

    y:
      (vh - height) *
      0.5,

    width,
    height
  };
}


/* ============================================================
 * BUILD CODEPEN SLIDE
 * ============================================================ */

function buildSlide(phase) {

  const triangleCount =
    SEGMENTS_X *
    SEGMENTS_Y *
    2;

  const vertexCount =
    triangleCount * 3;

  const data =
    new Float32Array(
      vertexCount *
      FLOATS_PER_VERTEX
    );

  let ptr = 0;

  const cellWidth =
    WIDTH /
    SEGMENTS_X;

  const cellHeight =
    HEIGHT /
    SEGMENTS_Y;

  function writeVertex(
    x,
    y,
    centroidX,
    centroidY,
    control0,
    control1,
    delay,
    duration,
    u,
    v
  ) {

    /*
     * position relative to centroid
     */
    data[ptr++] =
      x - centroidX;

    data[ptr++] =
      y - centroidY;

    data[ptr++] =
      0;

    /*
     * start / end position
     *
     * Both are centroid in the original.
     */
    data[ptr++] =
      centroidX;

    data[ptr++] =
      centroidY;

    data[ptr++] =
      0;

    /*
     * control point 0
     */
    data[ptr++] =
      control0.x;

    data[ptr++] =
      control0.y;

    data[ptr++] =
      control0.z;

    /*
     * control point 1
     */
    data[ptr++] =
      control1.x;

    data[ptr++] =
      control1.y;

    data[ptr++] =
      control1.z;

    /*
     * animation
     */
    data[ptr++] =
      delay;

    data[ptr++] =
      duration;

    /*
     * UV
     */
    data[ptr++] =
      u;

    data[ptr++] =
      v;
  }

  for (
    let row = 0;
    row < SEGMENTS_Y;
    row++
  ) {

    for (
      let col = 0;
      col < SEGMENTS_X;
      col++
    ) {

      const x0 =
        -WIDTH * 0.5 +
        col * cellWidth;

      const x1 =
        x0 + cellWidth;

      const y0 =
        HEIGHT * 0.5 -
        row * cellHeight;

      const y1 =
        y0 - cellHeight;

      /*
       * Same two triangles produced by
       * PlaneGeometry.
       */
      const faces = [
        [
          [x0, y0],
          [x1, y0],
          [x0, y1]
        ],

        [
          [x1, y0],
          [x1, y1],
          [x0, y1]
        ]
      ];

      for (
        const face of faces
      ) {

        /*
         * EXACT CodePen centroid.
         */
        const centroidX =
          (
            face[0][0] +
            face[1][0] +
            face[2][0]
          ) / 3;

        const centroidY =
          (
            face[0][1] +
            face[1][1] +
            face[2][1]
          ) / 3;

        /*
         * EXACT CodePen duration.
         */
        const duration =
          randFloat(
            MIN_DURATION,
            MAX_DURATION
          );

        /*
         * EXACT CodePen delay X.
         */
        const delayX =
          mapLinear(
            centroidX,
            -WIDTH * 0.5,
            WIDTH * 0.5,
            0,
            MAX_DELAY_X
          );

        /*
         * EXACT CodePen delay Y.
         */
        let delayY;

        if (
          phase === "in"
        ) {

          delayY =
            mapLinear(
              Math.abs(
                centroidY
              ),
              0,
              HEIGHT * 0.5,
              0,
              MAX_DELAY_Y
            );

        } else {

          delayY =
            mapLinear(
              Math.abs(
                centroidY
              ),
              0,
              HEIGHT * 0.5,
              MAX_DELAY_Y,
              0
            );
        }

        /*
         * IMPORTANT:
         *
         * The original CodePen calls Math.random()
         * separately for each vertex.
         */
        const delays = [
          delayX +
          delayY +
          Math.random() *
          STRETCH *
          duration,

          delayX +
          delayY +
          Math.random() *
          STRETCH *
          duration,

          delayX +
          delayY +
          Math.random() *
          STRETCH *
          duration
        ];

        /*
         * EXACT CodePen control point 0.
         *
         * No artificial scaling.
         */
        const signY =
          Math.sign(
            centroidY
          );

        const cp0 = {
          x:
            randFloat(
              0.1,
              0.3
            ) * 50,

          y:
            signY *
            randFloat(
              0.1,
              0.3
            ) * 70,

          z:
            randFloatSpread(20)
        };

        /*
         * EXACT CodePen control point 1.
         */
        const cp1 = {
          x:
            randFloat(
              0.3,
              0.6
            ) * 50,

          y:
            -signY *
            randFloat(
              0.3,
              0.6
            ) * 70,

          z:
            randFloatSpread(20)
        };

        let control0;
        let control1;

        /*
         * EXACT:
         *
         * IN:
         * centroid - control
         *
         * OUT:
         * centroid + control
         */
        if (
          phase === "in"
        ) {

          control0 = {
            x:
              centroidX -
              cp0.x,

            y:
              centroidY -
              cp0.y,

            z:
              -cp0.z
          };

          control1 = {
            x:
              centroidX -
              cp1.x,

            y:
              centroidY -
              cp1.y,

            z:
              -cp1.z
          };

        } else {

          control0 = {
            x:
              centroidX +
              cp0.x,

            y:
              centroidY +
              cp0.y,

            z:
              cp0.z
          };

          control1 = {
            x:
              centroidX +
              cp1.x,

            y:
              centroidY +
              cp1.y,

            z:
              cp1.z
          };
        }

        for (
          let vertexIndex = 0;
          vertexIndex < 3;
          vertexIndex++
        ) {

          const x =
            face[
              vertexIndex
            ][0];

          const y =
            face[
              vertexIndex
            ][1];

          const u =
            (
              x +
              WIDTH * 0.5
            ) /
            WIDTH;

          const v =
            1 -
            (
              (
                y +
                HEIGHT * 0.5
              ) /
              HEIGHT
            );

          writeVertex(
            x,
            y,
            centroidX,
            centroidY,
            control0,
            control1,
            delays[
              vertexIndex
            ],
            duration,
            u,
            v
          );
        }
      }
    }
  }

  return {
    data,
    vertexCount
  };
}


/* ============================================================
 * VERTEX SHADER
 * ============================================================ */

const VERTEX_SHADER = `
precision highp float;

attribute vec3 aLocal;
attribute vec3 aCentroid;
attribute vec3 aControl0;
attribute vec3 aControl1;

attribute float aDelay;
attribute float aDuration;

attribute vec2 aUV;

uniform float uTime;
uniform float uIncoming;

uniform float uCameraZ;
uniform float uTanHalfFov;
uniform float uAspect;

uniform float uBaseHalfNdcX;
uniform float uBaseHalfNdcY;

uniform float uRectX;
uniform float uRectY;
uniform float uRectW;
uniform float uRectH;

uniform float uViewportW;
uniform float uViewportH;

varying vec2 vUV;

float easeInOutCubic(
  float t
) {

  t = clamp(
    t,
    0.0,
    1.0
  );

  if (
    t < 0.5
  ) {

    return
      4.0 *
      t *
      t *
      t;
  }

  return
    1.0 -
    pow(
      -2.0 * t +
      2.0,
      3.0
    ) /
    2.0;
}

vec3 cubicBezier(
  vec3 p0,
  vec3 p1,
  vec3 p2,
  vec3 p3,
  float t
) {

  float mt =
    1.0 - t;

  return
    mt * mt * mt * p0 +
    3.0 *
    mt * mt *
    t *
    p1 +
    3.0 *
    mt *
    t *
    t *
    p2 +
    t *
    t *
    t *
    p3;
}

void main() {

  /*
   * EXACT CodePen timing.
   */
  float tTime =
    clamp(
      uTime -
      aDelay,
      0.0,
      aDuration
    );

  float tProgress =
    aDuration > 0.0
      ? easeInOutCubic(
          tTime /
          aDuration
        )
      : 1.0;

  /*
   * EXACT CodePen:
   *
   * IN:
   * transformed *= tProgress
   *
   * OUT:
   * transformed *= 1.0 - tProgress
   */
  float scale =
    uIncoming > 0.5
      ? tProgress
      : 1.0 - tProgress;

  /*
   * EXACT CodePen cubic Bezier:
   *
   * start = centroid
   * end   = centroid
   */
  vec3 center =
    cubicBezier(
      aCentroid,
      aControl0,
      aControl1,
      aCentroid,
      tProgress
    );

  /*
   * Face shrinks / grows around
   * its centroid.
   */
  vec3 world =
    center +
    aLocal *
    scale;

  /*
   * PerspectiveCamera:
   *
   * FOV = 80
   * Z   = 60
   */
  float depth =
    max(
      0.001,
      uCameraZ -
      world.z
    );

  float ndcX =
    world.x /
    (
      depth *
      uTanHalfFov *
      uAspect
    );

  float ndcY =
    world.y /
    (
      depth *
      uTanHalfFov
    );

  /*
   * Convert the original 100x60
   * CodePen plane into normalized
   * coordinates.
   */
  float normalizedX =
    ndcX /
    uBaseHalfNdcX;

  float normalizedY =
    ndcY /
    uBaseHalfNdcY;

  /*
   * Put that normalized plane into
   * the actual contain rectangle.
   */
  float pixelX =
    uRectX +
    (
      normalizedX +
      1.0
    ) *
    uRectW *
    0.5;

  float pixelY =
    uRectY +
    (
      normalizedY +
      1.0
    ) *
    uRectH *
    0.5;

  /*
   * Convert pixels to WebGL clip space.
   */
  float finalX =
    (
      pixelX /
      uViewportW
    ) *
    2.0 -
    1.0;

  float finalY =
    1.0 -
    (
      pixelY /
      uViewportH
    ) *
    2.0;

  gl_Position =
    vec4(
      finalX,
      finalY,
      0.0,
      1.0
    );

  vUV = aUV;
}
`;


/* ============================================================
 * FRAGMENT SHADER
 * ============================================================ */

const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uTexture;

varying vec2 vUV;

void main() {

  gl_FragColor =
    texture2D(
      uTexture,
      vUV
    );
}
`;


/* ============================================================
 * WEBGL
 * ============================================================ */

function compileShader(
  gl,
  type,
  source
) {

  const shader =
    gl.createShader(type);

  if (!shader) {
    throw new Error(
      "particle: shader creation failed"
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

    const info =
      gl.getShaderInfoLog(
        shader
      ) ||
      "unknown shader error";

    gl.deleteShader(
      shader
    );

    throw new Error(
      "particle shader compile error: " +
      info
    );
  }

  return shader;
}

function createProgram(gl) {

  const vertexShader =
    compileShader(
      gl,
      gl.VERTEX_SHADER,
      VERTEX_SHADER
    );

  const fragmentShader =
    compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER
    );

  const program =
    gl.createProgram();

  gl.attachShader(
    program,
    vertexShader
  );

  gl.attachShader(
    program,
    fragmentShader
  );

  gl.linkProgram(
    program
  );

  gl.deleteShader(
    vertexShader
  );

  gl.deleteShader(
    fragmentShader
  );

  if (
    !gl.getProgramParameter(
      program,
      gl.LINK_STATUS
    )
  ) {

    throw new Error(
      "particle program link error: " +
      (
        gl.getProgramInfoLog(
          program
        ) || ""
      )
    );
  }

  return program;
}

function createTexture(gl) {

  const texture =
    gl.createTexture();

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

  return texture;
}

function getGLState(canvas) {

  if (
    particleGL &&
    particleGL.canvas === canvas &&
    !particleGL.gl.isContextLost()
  ) {
    return particleGL;
  }

  const gl =
    canvas.getContext(
      "webgl",
      {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false
      }
    );

  if (!gl) {
    throw new Error(
      "particle transition: WebGL unavailable"
    );
  }

  const program =
    createProgram(gl);

  const attributes = {
    local:
      gl.getAttribLocation(
        program,
        "aLocal"
      ),

    centroid:
      gl.getAttribLocation(
        program,
        "aCentroid"
      ),

    control0:
      gl.getAttribLocation(
        program,
        "aControl0"
      ),

    control1:
      gl.getAttribLocation(
        program,
        "aControl1"
      ),

    delay:
      gl.getAttribLocation(
        program,
        "aDelay"
      ),

    duration:
      gl.getAttribLocation(
        program,
        "aDuration"
      ),

    uv:
      gl.getAttribLocation(
        program,
        "aUV"
      )
  };

  const uniforms = {
    time:
      gl.getUniformLocation(
        program,
        "uTime"
      ),

    incoming:
      gl.getUniformLocation(
        program,
        "uIncoming"
      ),

    cameraZ:
      gl.getUniformLocation(
        program,
        "uCameraZ"
      ),

    tanHalfFov:
      gl.getUniformLocation(
        program,
        "uTanHalfFov"
      ),

    aspect:
      gl.getUniformLocation(
        program,
        "uAspect"
      ),

    baseHalfNdcX:
      gl.getUniformLocation(
        program,
        "uBaseHalfNdcX"
      ),

    baseHalfNdcY:
      gl.getUniformLocation(
        program,
        "uBaseHalfNdcY"
      ),

    rectX:
      gl.getUniformLocation(
        program,
        "uRectX"
      ),

    rectY:
      gl.getUniformLocation(
        program,
        "uRectY"
      ),

    rectW:
      gl.getUniformLocation(
        program,
        "uRectW"
      ),

    rectH:
      gl.getUniformLocation(
        program,
        "uRectH"
      ),

    viewportW:
      gl.getUniformLocation(
        program,
        "uViewportW"
      ),

    viewportH:
      gl.getUniformLocation(
        program,
        "uViewportH"
      ),

    texture:
      gl.getUniformLocation(
        program,
        "uTexture"
      )
  };

  const textureOut =
    createTexture(gl);

  const textureIn =
    createTexture(gl);

  particleGL = {
    canvas,
    gl,
    program,
    attributes,
    uniforms,
    textureOut,
    textureIn,
    bufferOut:
      gl.createBuffer(),
    bufferIn:
      gl.createBuffer()
  };

  return particleGL;
}


/* ============================================================
 * BUFFER / TEXTURE
 * ============================================================ */

function uploadGeometry(
  gl,
  buffer,
  data
) {

  gl.bindBuffer(
    gl.ARRAY_BUFFER,
    buffer
  );

  gl.bufferData(
    gl.ARRAY_BUFFER,
    data,
    gl.STATIC_DRAW
  );
}

function bindGeometry(
  gl,
  attributes,
  buffer
) {

  gl.bindBuffer(
    gl.ARRAY_BUFFER,
    buffer
  );

  const stride =
    BYTES_PER_VERTEX;

  let offset = 0;

  function bind(
    location,
    size
  ) {

    if (location >= 0) {

      gl.enableVertexAttribArray(
        location
      );

      gl.vertexAttribPointer(
        location,
        size,
        gl.FLOAT,
        false,
        stride,
        offset
      );
    }

    offset +=
      size * 4;
  }

  bind(
    attributes.local,
    3
  );

  bind(
    attributes.centroid,
    3
  );

  bind(
    attributes.control0,
    3
  );

  bind(
    attributes.control1,
    3
  );

  bind(
    attributes.delay,
    1
  );

  bind(
    attributes.duration,
    1
  );

  bind(
    attributes.uv,
    2
  );
}

/* ============================================================
 * IMAGE ORIENTATION NORMALIZATION
 * ============================================================
 *
 * Same fix, same reasoning as turbulent-dissolve.js's
 * getOrientationSafeImageSource(): some source images carry an EXIF
 * Orientation tag; <img> display honors it, gl.texImage2D(imgElement)
 * is not guaranteed to. Drawing onto a canvas first (which DOES honor
 * EXIF, same as <img>) before uploading to WebGL keeps this engine's
 * rendering consistent with what the DOM shows before/after it runs.
 */
function getOrientationSafeImageSource(img) {
  if (!img || img.tagName !== "IMG") return img;
  const cacheKey = img.currentSrc || img.src;
  if (
    img._ptNormalized &&
    img._ptNormalizedKey === cacheKey &&
    img._ptNormalized.width === (img.naturalWidth || img._ptNormalized.width)
  ) {
    return img._ptNormalized;
  }
  try {
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    img._ptNormalized = canvas;
    img._ptNormalizedKey = cacheKey;
    return canvas;
  } catch (err) {
    return img;
  }
}

function uploadTexture(
  gl,
  texture,
  image
) {

  gl.bindTexture(
    gl.TEXTURE_2D,
    texture
  );

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
    getOrientationSafeImageSource(image)
  );
}


/* ============================================================
 * CANVAS
 * ============================================================ */

function ensureCanvas(
  container
) {

  let canvas =
    container.querySelector(
      "canvas.player-transition-canvas"
    );

  if (!canvas) {

    canvas =
      document.createElement(
        "canvas"
      );

    canvas.className =
      "player-transition-canvas";

    container.appendChild(
      canvas
    );
  }

  Object.assign(
    canvas.style,
    {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
      pointerEvents: "none",
      zIndex: "999999",
      opacity: "1",
      background:
        "transparent"
    }
  );

  return canvas;
}


/* ============================================================
 * LAYER CONTROL
 * ============================================================ */

function hideIncomingLayer(
  layer
) {

  if (!layer) {
    return;
  }

  layer.classList.remove(
    "active"
  );

  layer.classList.add(
    "no-anim"
  );

  Object.assign(
    layer.style,
    {
      display: "none",
      opacity: "0",
      visibility: "hidden",
      pointerEvents: "none",
      zIndex: "-1",
      transition: "none"
    }
  );
}

function showIncomingLayer(
  layer
) {

  if (!layer) {
    return;
  }

  layer.classList.add(
    "no-anim"
  );

  Object.assign(
    layer.style,
    {
      display: "flex",
      opacity: "1",
      visibility: "visible",
      pointerEvents: "",
      zIndex: ""
    }
  );

  layer.classList.add(
    "active"
  );

  void layer.offsetWidth;

  layer.classList.remove(
    "no-anim"
  );

  layer.style.transition = "";
}

function removeOutgoingLayer(
  layer
) {

  if (!layer) {
    return;
  }

  layer.classList.remove(
    "active"
  );

  layer.classList.add(
    "no-anim"
  );

  Object.assign(
    layer.style,
    {
      display: "none",
      opacity: "0",
      visibility: "hidden",
      pointerEvents: "none",
      zIndex: "-1"
    }
  );
}


/* ============================================================
 * MAIN
 * ============================================================ */

async function performParticleTransition({
  currentLayer,
  nextLayer,
  durationMs =
    DEFAULT_DURATION_MS,
  dlog = () => {}
}) {

  if (
    !currentLayer ||
    !nextLayer
  ) {

    throw new Error(
      "particle transition: layers are required"
    );
  }

  const outgoingImage =
    findImage(
      currentLayer
    );

  const incomingImage =
    findImage(
      nextLayer
    );

  /*
   * This engine is deliberately IMAGE -> IMAGE only.
   */
  if (
    !outgoingImage ||
    !incomingImage
  ) {

    throw new Error(
      "particle transition requires IMAGE -> IMAGE"
    );
  }

  /*
   * The incoming DOM layer is hidden BEFORE
   * anything starts.
   */
  hideIncomingLayer(
    nextLayer
  );

  /*
   * Wait for the actual image bitmap.
   */
  const ready =
    await waitForImage(
      incomingImage
    );

  if (!ready) {

    throw new Error(
      "particle transition: incoming image not ready"
    );
  }

  /*
   * Use the existing transition container if available.
   * Otherwise use the display layer's parent.
   *
   * This prevents a missing #bas-canvas-container
   * from silently turning this into an opacity cut.
   */
  let container =
    document.getElementById(
      "bas-canvas-container"
    );

  if (!container) {

    container =
      currentLayer.parentElement ||
      nextLayer.parentElement ||
      document.body;
  }

  if (!container) {

    throw new Error(
      "particle transition: no render container"
    );
  }

  /*
   * FOUND ROOT CAUSE OF "NO VISIBLE TRANSITION" (shared with
   * turbulent-dissolve.js): when `container` is #bas-canvas-container
   * (the normal case on the Big Display), it carries
   * class="player-transition-canvas", whose base CSS rule is
   * `opacity: 0` - only the `.on` modifier sets opacity: 1. Nothing
   * anywhere ever added `.on`, so this container's entire subtree,
   * including the <canvas> this engine paints into, was composited at
   * 0% opacity regardless of the canvas's own inline opacity/display.
   * The particle animation itself was running correctly the whole
   * time; it just was never visible. Toggling `.on` here is a no-op
   * on the document.body/parentElement fallback paths, which don't
   * carry this class.
   */
  container.classList.add(
    "on"
  );

  const canvas =
    ensureCanvas(
      container
    );

  const state =
    getGLState(
      canvas
    );

  const {
    gl,
    program,
    attributes,
    uniforms
  } = state;

  const bounds =
    container.getBoundingClientRect();

  const viewportWidth =
    Math.max(
      1,
      Math.round(
        bounds.width ||
        window.innerWidth
      )
    );

  const viewportHeight =
    Math.max(
      1,
      Math.round(
        bounds.height ||
        window.innerHeight
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
        viewportWidth *
        dpr
      )
    );

  canvas.height =
    Math.max(
      1,
      Math.round(
        viewportHeight *
        dpr
      )
    );

  gl.viewport(
    0,
    0,
    canvas.width,
    canvas.height
  );

  /*
   * Each image gets its OWN contain rectangle.
   *
   * This is what prevents landscape/portrait
   * stretching.
   */
  const outgoingRect =
    getContainRect(
      outgoingImage.naturalWidth,
      outgoingImage.naturalHeight,
      viewportWidth,
      viewportHeight
    );

  const incomingRect =
    getContainRect(
      incomingImage.naturalWidth,
      incomingImage.naturalHeight,
      viewportWidth,
      viewportHeight
    );

  /*
   * Build the exact 100x60 CodePen geometry.
   */
  const outgoingSlide =
    buildSlide("out");

  const incomingSlide =
    buildSlide("in");

  uploadGeometry(
    gl,
    state.bufferOut,
    outgoingSlide.data
  );

  uploadGeometry(
    gl,
    state.bufferIn,
    incomingSlide.data
  );

  /*
   * Upload both images BEFORE animation.
   */
  uploadTexture(
    gl,
    state.textureOut,
    outgoingImage
  );

  uploadTexture(
    gl,
    state.textureIn,
    incomingImage
  );

  gl.useProgram(
    program
  );

  gl.disable(
    gl.DEPTH_TEST
  );

  gl.disable(
    gl.CULL_FACE
  );

  /*
   * Original CodePen uses opaque BasicAnimationMaterial.
   */
  gl.disable(
    gl.BLEND
  );

  gl.clearColor(
    0,
    0,
    0,
    0
  );

  /*
   * EXACT camera.
   */
  const fovRadians =
    CAMERA_FOV *
    Math.PI /
    180;

  const tanHalfFov =
    Math.tan(
      fovRadians *
      0.5
    );

  const aspect =
    viewportWidth /
    Math.max(
      1,
      viewportHeight
    );

  /*
   * Projected half-size of the original
   * 100x60 plane at z=0.
   */
  const baseHalfNdcX =
    (
      WIDTH * 0.5
    ) /
    (
      CAMERA_Z *
      tanHalfFov *
      aspect
    );

  const baseHalfNdcY =
    (
      HEIGHT * 0.5
    ) /
    (
      CAMERA_Z *
      tanHalfFov
    );

  gl.uniform1f(
    uniforms.cameraZ,
    CAMERA_Z
  );

  gl.uniform1f(
    uniforms.tanHalfFov,
    tanHalfFov
  );

  gl.uniform1f(
    uniforms.aspect,
    aspect
  );

  gl.uniform1f(
    uniforms.baseHalfNdcX,
    baseHalfNdcX
  );

  gl.uniform1f(
    uniforms.baseHalfNdcY,
    baseHalfNdcY
  );

  gl.uniform1f(
    uniforms.viewportW,
    viewportWidth
  );

  gl.uniform1f(
    uniforms.viewportH,
    viewportHeight
  );

  /*
   * Keep the outgoing DOM ad underneath.
   */
  currentLayer.style.zIndex =
    "1";

  /*
   * Canvas becomes the ONLY transition surface.
   */
  canvas.style.display =
    "block";

  canvas.style.opacity =
    "1";

  /*
   * CodePen master timeline:
   *
   * TweenMax.fromTo(
   *   this,
   *   3.0,
   *   {time: 0},
   *   {time: totalDuration}
   * )
   */
  const actualDuration =
    Math.max(
      1,
      durationMs ||
      DEFAULT_DURATION_MS
    );

  const startTime =
    performance.now();

  let animationFrame =
    0;

  try {

    await new Promise(
      resolve => {

        const render =
          now => {

            const masterProgress =
              clamp(
                (
                  now -
                  startTime
                ) /
                actualDuration,
                0,
                1
              );

            /*
             * CodePen's uTime.
             */
            const time =
              masterProgress *
              TOTAL_DURATION;

            gl.clear(
              gl.COLOR_BUFFER_BIT
            );

            /*
             * =================================================
             * OUTGOING
             * =================================================
             */
            gl.uniform1f(
              uniforms.time,
              time
            );

            gl.uniform1f(
              uniforms.incoming,
              0
            );

            gl.uniform1f(
              uniforms.rectX,
              outgoingRect.x
            );

            gl.uniform1f(
              uniforms.rectY,
              outgoingRect.y
            );

            gl.uniform1f(
              uniforms.rectW,
              outgoingRect.width
            );

            gl.uniform1f(
              uniforms.rectH,
              outgoingRect.height
            );

            gl.activeTexture(
              gl.TEXTURE0
            );

            gl.bindTexture(
              gl.TEXTURE_2D,
              state.textureOut
            );

            gl.uniform1i(
              uniforms.texture,
              0
            );

            bindGeometry(
              gl,
              attributes,
              state.bufferOut
            );

            gl.drawArrays(
              gl.TRIANGLES,
              0,
              outgoingSlide.vertexCount
            );

            /*
             * =================================================
             * INCOMING
             * =================================================
             *
             * Drawn in the SAME frame.
             *
             * It is NOT placed over the old DOM layer.
             */
            gl.uniform1f(
              uniforms.incoming,
              1
            );

            gl.uniform1f(
              uniforms.rectX,
              incomingRect.x
            );

            gl.uniform1f(
              uniforms.rectY,
              incomingRect.y
            );

            gl.uniform1f(
              uniforms.rectW,
              incomingRect.width
            );

            gl.uniform1f(
              uniforms.rectH,
              incomingRect.height
            );

            gl.activeTexture(
              gl.TEXTURE0
            );

            gl.bindTexture(
              gl.TEXTURE_2D,
              state.textureIn
            );

            bindGeometry(
              gl,
              attributes,
              state.bufferIn
            );

            gl.drawArrays(
              gl.TRIANGLES,
              0,
              incomingSlide.vertexCount
            );

            /*
             * =================================================
             * FINISH
             * =================================================
             */
            if (
              masterProgress >= 1
            ) {

              gl.finish();

              /*
               * VERY IMPORTANT:
               *
               * Do NOT reveal the DOM incoming layer
               * until the particle animation is complete.
               */
              showIncomingLayer(
                nextLayer
              );

              removeOutgoingLayer(
                currentLayer
              );

              canvas.style.opacity =
                "0";

              canvas.style.display =
                "none";

              container.classList.remove(
                "on"
              );

              resolve();

              return;
            }

            animationFrame =
              requestAnimationFrame(
                render
              );
          };

        animationFrame =
          requestAnimationFrame(
            render
          );
      }
    );

  } catch (error) {

    if (animationFrame) {
      cancelAnimationFrame(
        animationFrame
      );
    }

    canvas.style.opacity =
      "0";

    canvas.style.display =
      "none";

    try {
      container.classList.remove(
        "on"
      );
    } catch (_) {}

    try {
      dlog(
        "particle-transition error",
        error
      );
    } catch (_) {}

    /*
     * IMPORTANT:
     * Do NOT silently opacity-crossfade.
     * That hides the actual particle-engine failure.
     */
    throw error;
  }
}

/* ============================================================
 * PUBLIC API
 * ============================================================ */

export function runParticleTransition(
  options = {}
) {

  /*
   * Serialize transitions on this engine's shared WebGL canvas the same
   * way runTurbulentDissolve() does for its own canvas.
   */
  const execute =
    () =>
      performParticleTransition(
        options
      );

  const result =
    particleTransitionQueue.then(
      execute,
      execute
    );

  particleTransitionQueue =
    result.then(
      () => undefined,
      () => undefined
    );

  return result;
}
