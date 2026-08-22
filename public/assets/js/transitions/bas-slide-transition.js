/**
 * bas-slide-transition.js
 * ------------------------------------------------------------------------
 * "Engine 2" — Image -> Image transition, adapted from the pasted
 * reference (Slide / SlideGeometry classes kept essentially unchanged,
 * only the outer bootstrap/scrubber code was replaced with a reusable
 * lifecycle manager suitable for a display loop that runs indefinitely).
 *
 * Depends on:
 *   - three.js, legacy build (r126 or earlier — needs THREE.Geometry,
 *     THREE.Face3, THREE.Math). Loaded as a global via <script> in
 *     display.html.
 *   - mini-bas.js (loaded right after three.js, also as a global).
 *   - gsap (for the tween driving the shared uTime uniform).
 *
 * Exposes a single default export: getTransitionEngine(container), which
 * lazily creates (once) and returns a manager object:
 *
 *   {
 *     ready: boolean,
 *     runImageTransition(fromImgEl, toImgEl, { duration }) -> Promise
 *   }
 * ------------------------------------------------------------------------
 */

let engineInstance = null;
let depsReadyPromise = null;

/**
 * Resolves once window.THREE, window.THREE.BAS (set by mini-bas.js) and
 * window.gsap are all present. Guards against display.js calling
 * getTransitionEngine() before the classic <script> tags in display.html
 * have finished loading/executing (e.g. a slow network on first paint),
 * regardless of how reliable the plain script-tag order is in practice.
 * Does not touch the transition itself - purely a load-order gate.
 */
export function ensureTransitionDepsReady(timeoutMs = 3000) {
  if (!depsReadyPromise) {
    depsReadyPromise = new Promise((resolve, reject) => {
      const start = performance.now();
      (function poll() {
        if (window.THREE && window.THREE.BAS && window.gsap) {
          resolve();
          return;
        }
        // Fast path: a script tag's onerror handler (or mini-bas.js's own
        // load-order guard) already told us this load is never going to
        // succeed — don't make the display sit on a stuck/empty frame for
        // the rest of the timeout window waiting to find that out.
        if (window.__lumenTransitionDepsFailed) {
          reject(new Error('Transition dependencies failed to load (see console for which script).'));
          return;
        }
        if (performance.now() - start > timeoutMs) {
          reject(new Error(
            'Transition dependencies did not become ready in time ' +
            '(three.js legacy build + mini-bas.js + gsap). Check that ' +
            'all three <script> tags in display.html loaded successfully.'
          ));
          return;
        }
        requestAnimationFrame(poll);
      })();
    });
  }
  return depsReadyPromise;
}

function buildSlideClasses(THREE) {
  function SlideGeometry(model) {
    THREE.BAS.ModelBufferGeometry.call(this, model);
  }
  SlideGeometry.prototype = Object.create(THREE.BAS.ModelBufferGeometry.prototype);
  SlideGeometry.prototype.constructor = SlideGeometry;
  SlideGeometry.prototype.bufferPositions = function () {
    var positionBuffer = this.createAttribute('position', 3).array;

    for (var i = 0; i < this.faceCount; i++) {
      var face = this.modelGeometry.faces[i];
      var centroid = THREE.BAS.Utils.computeCentroid(this.modelGeometry, face);

      var a = this.modelGeometry.vertices[face.a];
      var b = this.modelGeometry.vertices[face.b];
      var c = this.modelGeometry.vertices[face.c];

      positionBuffer[face.a * 3] = a.x - centroid.x;
      positionBuffer[face.a * 3 + 1] = a.y - centroid.y;
      positionBuffer[face.a * 3 + 2] = a.z - centroid.z;

      positionBuffer[face.b * 3] = b.x - centroid.x;
      positionBuffer[face.b * 3 + 1] = b.y - centroid.y;
      positionBuffer[face.b * 3 + 2] = b.z - centroid.z;

      positionBuffer[face.c * 3] = c.x - centroid.x;
      positionBuffer[face.c * 3 + 1] = c.y - centroid.y;
      positionBuffer[face.c * 3 + 2] = c.z - centroid.z;
    }
  };

  function Slide(width, height, animationPhase) {
    var plane = new THREE.PlaneGeometry(width, height, Math.round(width * 2), Math.round(height * 2));

    THREE.BAS.Utils.separateFaces(plane);

    var geometry = new SlideGeometry(plane);
    geometry.bufferUVs();

    var aAnimation = geometry.createAttribute('aAnimation', 2);
    var aStartPosition = geometry.createAttribute('aStartPosition', 3);
    var aControl0 = geometry.createAttribute('aControl0', 3);
    var aControl1 = geometry.createAttribute('aControl1', 3);
    var aEndPosition = geometry.createAttribute('aEndPosition', 3);

    var i, i2, i3, v;

    var minDuration = 0.8;
    var maxDuration = 1.2;
    var maxDelayX = 0.9;
    var maxDelayY = 0.125;
    var stretch = 0.11;

    this.totalDuration = maxDuration + maxDelayX + maxDelayY + stretch;

    var startPosition = new THREE.Vector3();
    var control0 = new THREE.Vector3();
    var control1 = new THREE.Vector3();
    var endPosition = new THREE.Vector3();
    var tempPoint = new THREE.Vector3();

    function getControlPoint0(centroid) {
      var signY = Math.sign(centroid.y) || 1;
      tempPoint.x = THREE.Math.randFloat(0.1, 0.3) * 50;
      tempPoint.y = signY * THREE.Math.randFloat(0.1, 0.3) * 70;
      tempPoint.z = THREE.Math.randFloatSpread(20);
      return tempPoint;
    }

    function getControlPoint1(centroid) {
      var signY = Math.sign(centroid.y) || 1;
      tempPoint.x = THREE.Math.randFloat(0.3, 0.6) * 50;
      tempPoint.y = -signY * THREE.Math.randFloat(0.3, 0.6) * 70;
      tempPoint.z = THREE.Math.randFloatSpread(20);
      return tempPoint;
    }

    for (i = 0, i2 = 0, i3 = 0; i < geometry.faceCount; i++, i2 += 6, i3 += 9) {
      var face = plane.faces[i];
      var centroid = THREE.BAS.Utils.computeCentroid(plane, face);

      var duration = THREE.Math.randFloat(minDuration, maxDuration);
      var delayX = THREE.Math.mapLinear(centroid.x, -width * 0.5, width * 0.5, 0.0, maxDelayX);
      var delayY;

      if (animationPhase === 'in') {
        delayY = THREE.Math.mapLinear(Math.abs(centroid.y), 0, height * 0.5, 0.0, maxDelayY);
      } else {
        delayY = THREE.Math.mapLinear(Math.abs(centroid.y), 0, height * 0.5, maxDelayY, 0.0);
      }

      for (v = 0; v < 6; v += 2) {
        aAnimation.array[i2 + v] = delayX + delayY + (Math.random() * stretch * duration);
        aAnimation.array[i2 + v + 1] = duration;
      }

      endPosition.copy(centroid);
      startPosition.copy(centroid);

      if (animationPhase === 'in') {
        control0.copy(centroid).sub(getControlPoint0(centroid));
        control1.copy(centroid).sub(getControlPoint1(centroid));
      } else {
        control0.copy(centroid).add(getControlPoint0(centroid));
        control1.copy(centroid).add(getControlPoint1(centroid));
      }

      for (v = 0; v < 9; v += 3) {
        aStartPosition.array[i3 + v] = startPosition.x;
        aStartPosition.array[i3 + v + 1] = startPosition.y;
        aStartPosition.array[i3 + v + 2] = startPosition.z;

        aControl0.array[i3 + v] = control0.x;
        aControl0.array[i3 + v + 1] = control0.y;
        aControl0.array[i3 + v + 2] = control0.z;

        aControl1.array[i3 + v] = control1.x;
        aControl1.array[i3 + v + 1] = control1.y;
        aControl1.array[i3 + v + 2] = control1.z;

        aEndPosition.array[i3 + v] = endPosition.x;
        aEndPosition.array[i3 + v + 1] = endPosition.y;
        aEndPosition.array[i3 + v + 2] = endPosition.z;
      }
    }

    var material = new THREE.BAS.BasicAnimationMaterial(
      {
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        shaderFunctions: [
          THREE.BAS.ShaderChunk['cubic_bezier'],
          THREE.BAS.ShaderChunk['ease_in_out_cubic'],
          THREE.BAS.ShaderChunk['quaternion_rotation']
        ],
        shaderParameters: [
          'uniform float uTime;',
          'attribute vec2 aAnimation;',
          'attribute vec3 aStartPosition;',
          'attribute vec3 aControl0;',
          'attribute vec3 aControl1;',
          'attribute vec3 aEndPosition;'
        ],
        shaderVertexInit: [
          'float tDelay = aAnimation.x;',
          'float tDuration = aAnimation.y;',
          'float tTime = clamp(uTime - tDelay, 0.0, tDuration);',
          'float tProgress = ease(tTime, 0.0, 1.0, tDuration);'
        ],
        shaderTransformPosition: [
          animationPhase === 'in' ? 'transformed *= tProgress;' : 'transformed *= 1.0 - tProgress;',
          'transformed += cubicBezier(aStartPosition, aControl0, aControl1, aEndPosition, tProgress);'
        ]
      },
      { map: new THREE.Texture() }
    );

    THREE.Mesh.call(this, geometry, material);
    this.frustumCulled = false;
  }
  Slide.prototype = Object.create(THREE.Mesh.prototype);
  Slide.prototype.constructor = Slide;
  Object.defineProperty(Slide.prototype, 'time', {
    get: function () { return this.material.uniforms['uTime'].value; },
    set: function (v) { this.material.uniforms['uTime'].value = v; }
  });
  Slide.prototype.setImage = function (imageEl) {
    this.material.uniforms.map.value.image = imageEl;
    this.material.uniforms.map.value.needsUpdate = true;
  };
  Slide.prototype.dispose = function () {
    this.geometry.dispose();
    this.material.uniforms.map.value.dispose();
    this.material.dispose();
  };

  return { Slide: Slide, SlideGeometry: SlideGeometry };
}

class BASTransitionEngine {
  constructor(container) {
    const THREE = window.THREE;
    if (!THREE || !THREE.BAS) {
      throw new Error('three.js (legacy build) + mini-bas.js must be loaded before bas-slide-transition.js');
    }
    this.THREE = THREE;
    this.container = container;

    // Renderer/scene/camera are created exactly once and reused for
    // every subsequent transition (per the "create WebGL renderer only
    // once" requirement).
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 1, 1, 1000);
    this.camera.position.set(0, 0, 60);

    this._resize = this._resize.bind(this);
    this._resize();
    window.addEventListener('resize', this._resize);

    this._raf = null;
    this._current = null; // { slideOut, slideIn, tl }

    const classes = buildSlideClasses(THREE);
    this.Slide = classes.Slide;
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    // Recompute plane size so it exactly fills the frustum at the
    // camera's fixed distance, for any container aspect ratio.
    const vFov = (this.camera.fov * Math.PI) / 180;
    const distance = this.camera.position.z;
    this._planeHeight = 2 * Math.tan(vFov / 2) * distance;
    this._planeWidth = this._planeHeight * this.camera.aspect;
  }

  _disposeCurrent() {
    if (!this._current) return;
    this.scene.remove(this._current.slideOut, this._current.slideIn);
    this._current.slideOut.dispose();
    this._current.slideIn.dispose();
    this._current.tl && this._current.tl.kill();
    this._current = null;
  }

  _renderLoop() {
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(() => this._renderLoop());
  }

  /**
   * Sizes a plane so an image of its own natural aspect ratio fits inside
   * the camera frustum without stretching or cropping - the WebGL
   * equivalent of the object-fit: contain already used everywhere else
   * in this player. A portrait image on a landscape screen gets a
   * narrower, taller plane instead of being stretched to fill the full
   * frustum width.
   */
  _containSize(imgEl) {
    const naturalW = imgEl.naturalWidth || this._planeWidth;
    const naturalH = imgEl.naturalHeight || this._planeHeight;
    const imgAspect = naturalW / naturalH;
    const frustumAspect = this._planeWidth / this._planeHeight;

    if (imgAspect > frustumAspect) {
      // Image is relatively wider than the screen -> width-constrained.
      const width = this._planeWidth;
      return { width, height: width / imgAspect };
    }
    // Image is relatively taller than the screen (e.g. portrait on a
    // landscape display) -> height-constrained.
    const height = this._planeHeight;
    return { width: height * imgAspect, height };
  }

  /**
   * Runs the shatter/dissolve transition between two already-loaded
   * <img> elements. Resolves once the animation completes.
   */
  runImageTransition(fromImgEl, toImgEl, opts = {}) {
    this._disposeCurrent();
    this._resize();

    const Slide = this.Slide;
    const outSize = this._containSize(fromImgEl);
    const inSize = this._containSize(toImgEl);

    const slideOut = new Slide(outSize.width, outSize.height, 'out');
    slideOut.setImage(fromImgEl);
    const slideIn = new Slide(inSize.width, inSize.height, 'in');
    slideIn.setImage(toImgEl);

    this.scene.add(slideOut, slideIn);
    this._current = { slideOut, slideIn, tl: null };

    if (!this._raf) this._renderLoop();

    const duration = opts.duration || 1.6;

    return new Promise((resolve) => {
      const tl = window.gsap.timeline({
        onComplete: () => {
          this._disposeCurrent();
          resolve();
        }
      });
      tl.fromTo(slideOut, { time: 0 }, { time: slideOut.totalDuration, duration, ease: 'power1.inOut' }, 0);
      tl.fromTo(slideIn, { time: 0 }, { time: slideIn.totalDuration, duration, ease: 'power1.inOut' }, 0);
      this._current.tl = tl;
    });
  }

  destroy() {
    this._disposeCurrent();
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function getTransitionEngine(container) {
  if (!engineInstance) {
    engineInstance = new BASTransitionEngine(container);
  }
  return engineInstance;
}
