/**
 * mini-bas.js
 * ------------------------------------------------------------------------
 * A minimal, from-scratch implementation of the small subset of the
 * THREE.BAS API that the reference "Slide" transition code (see
 * bas-slide-transition.js) calls:
 *
 *   THREE.BAS.Utils.separateFaces(geometry)
 *   THREE.BAS.Utils.computeCentroid(geometry, face)
 *   THREE.BAS.ModelBufferGeometry
 *   THREE.BAS.BasicAnimationMaterial
 *   THREE.BAS.ShaderChunk['cubic_bezier']
 *   THREE.BAS.ShaderChunk['ease_in_out_cubic']
 *   THREE.BAS.ShaderChunk['quaternion_rotation']
 *
 * IMPORTANT: the real three-bas library source was not part of what was
 * provided to build this — only usage code that calls into it. This file
 * is NOT a copy of that library; it implements the same well-known,
 * public math (cubic Bezier interpolation, Penner's cubic ease-in-out,
 * per-face vertex duplication + centroid) so the reference Slide/
 * SlideGeometry code can run unmodified against it.
 *
 * Requires a THREE build that still exposes the legacy THREE.Geometry /
 * THREE.Face3 / THREE.Math API (this was removed from three.js in later
 * versions). Pin your <script> tag to three.js r126 or earlier.
 * ------------------------------------------------------------------------
 */
(function (THREE) {
  if (!THREE) {
    window.__lumenTransitionDepsFailed = true;
    throw new Error('mini-bas.js must be loaded after three.js');
  }

  THREE.BAS = THREE.BAS || {};

  // -----------------------------------------------------------------
  // Utils
  // -----------------------------------------------------------------
  THREE.BAS.Utils = {
    /**
     * Duplicates vertices so that no vertex is shared between faces.
     * Required because each face gets its own per-vertex animation
     * attributes (delay/duration/control points) in this transition.
     */
    separateFaces: function (geometry) {
      if (!geometry.faces) {
        throw new Error(
          '[Lumen] THREE.PlaneGeometry has no .faces - the loaded three.js ' +
          'build is a modern BufferGeometry-only version. This transition ' +
          'requires a pre-r125 three.js build (see display.html). Check ' +
          'that the three.js <script> tag version has not been changed.'
        );
      }

      var vertices = [];

      for (var i = 0; i < geometry.faces.length; i++) {
        var face = geometry.faces[i];

        var a = geometry.vertices[face.a].clone();
        var b = geometry.vertices[face.b].clone();
        var c = geometry.vertices[face.c].clone();

        var i3 = i * 3;
        vertices[i3] = a;
        vertices[i3 + 1] = b;
        vertices[i3 + 2] = c;

        face.a = i3;
        face.b = i3 + 1;
        face.c = i3 + 2;
      }

      geometry.vertices = vertices;
    },

    computeCentroid: function (geometry, face) {
      var a = geometry.vertices[face.a];
      var b = geometry.vertices[face.b];
      var c = geometry.vertices[face.c];

      return new THREE.Vector3(
        (a.x + b.x + c.x) / 3,
        (a.y + b.y + c.y) / 3,
        (a.z + b.z + c.z) / 3
      );
    }
  };

  // -----------------------------------------------------------------
  // ShaderChunk
  // -----------------------------------------------------------------
  THREE.BAS.ShaderChunk = {
    cubic_bezier: [
      'vec3 cubicBezier(vec3 p0, vec3 p1, vec3 p2, vec3 p3, float t) {',
      '  float tn = 1.0 - t;',
      '  return tn * tn * tn * p0 + 3.0 * tn * tn * t * p1 + 3.0 * tn * t * t * p2 + t * t * t * p3;',
      '}'
    ].join('\n'),

    // Penner's easeInOutCubic, standard published easing formula.
    ease_in_out_cubic: [
      'float ease(float t, float b, float c, float d) {',
      '  t /= d * 0.5;',
      '  if (t < 1.0) return c * 0.5 * t * t * t + b;',
      '  t -= 2.0;',
      '  return c * 0.5 * (t * t * t + 2.0) + b;',
      '}'
    ].join('\n'),

    // Not exercised by this particular transform, included because the
    // reference lists it among shaderFunctions.
    quaternion_rotation: [
      'vec3 applyQuaternionToVector(vec4 q, vec3 v) {',
      '  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);',
      '}'
    ].join('\n')
  };

  // -----------------------------------------------------------------
  // ModelBufferGeometry
  // -----------------------------------------------------------------
  function ModelBufferGeometry(model) {
    THREE.BufferGeometry.call(this);

    this.modelGeometry = model;
    this.faceCount = model.faces.length;
    this.vertexCount = model.vertices.length;

    this.bufferPositions();
    this.bufferNormals();
  }
  ModelBufferGeometry.prototype = Object.create(THREE.BufferGeometry.prototype);
  ModelBufferGeometry.prototype.constructor = ModelBufferGeometry;

  ModelBufferGeometry.prototype.createAttribute = function (name, itemSize) {
    var buffer = new Float32Array(this.vertexCount * itemSize);
    var attribute = new THREE.BufferAttribute(buffer, itemSize);
    this.setAttribute ? this.setAttribute(name, attribute) : this.addAttribute(name, attribute);
    return attribute;
  };

  ModelBufferGeometry.prototype.bufferPositions = function () {
    var positionBuffer = this.createAttribute('position', 3).array;
    var faces = this.modelGeometry.faces;
    var vertices = this.modelGeometry.vertices;

    for (var i = 0; i < faces.length; i++) {
      var face = faces[i];
      ['a', 'b', 'c'].forEach(function (key) {
        var idx = face[key];
        var v = vertices[idx];
        positionBuffer[idx * 3] = v.x;
        positionBuffer[idx * 3 + 1] = v.y;
        positionBuffer[idx * 3 + 2] = v.z;
      });
    }
  };

  ModelBufferGeometry.prototype.bufferNormals = function () {
    var normalBuffer = this.createAttribute('normal', 3).array;
    var faces = this.modelGeometry.faces;

    for (var i = 0; i < faces.length; i++) {
      var face = faces[i];
      var n = face.normal || new THREE.Vector3(0, 0, 1);
      ['a', 'b', 'c'].forEach(function (key) {
        var idx = face[key];
        normalBuffer[idx * 3] = n.x;
        normalBuffer[idx * 3 + 1] = n.y;
        normalBuffer[idx * 3 + 2] = n.z;
      });
    }
  };

  ModelBufferGeometry.prototype.bufferUVs = function () {
    var uvBuffer = this.createAttribute('uv', 2).array;
    var faces = this.modelGeometry.faces;
    var faceVertexUvs = (this.modelGeometry.faceVertexUvs && this.modelGeometry.faceVertexUvs[0]) || [];

    for (var i = 0; i < faces.length; i++) {
      var face = faces[i];
      var uvs = faceVertexUvs[i] || [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
      var keys = ['a', 'b', 'c'];
      for (var k = 0; k < 3; k++) {
        var idx = face[keys[k]];
        uvBuffer[idx * 2] = uvs[k].x;
        uvBuffer[idx * 2 + 1] = uvs[k].y;
      }
    }
  };

  THREE.BAS.ModelBufferGeometry = ModelBufferGeometry;

  // -----------------------------------------------------------------
  // BasicAnimationMaterial
  // -----------------------------------------------------------------
  function BasicAnimationMaterial(params, textureParams) {
    params = params || {};
    textureParams = textureParams || {};

    var uniforms = THREE.UniformsUtils.merge([
      { map: { value: textureParams.map || new THREE.Texture() } },
      params.uniforms || {}
    ]);

    var functions = (params.shaderFunctions || []).join('\n');
    var paramLines = (params.shaderParameters || []).join('\n');
    var initLines = (params.shaderVertexInit || []).join('\n');
    var transformLines = (params.shaderTransformPosition || []).join('\n');

    var vertexShader = [
      // NOTE: position, uv, modelViewMatrix, projectionMatrix are NOT
      // declared here on purpose - THREE.ShaderMaterial auto-injects all
      // four into every vertex shader it compiles. Redeclaring them
      // causes a GLSL "redefinition" compile failure (this was the
      // "Vertex shader is not compiled" error).
      paramLines,
      functions,
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  vec3 transformed = position;',
      initLines,
      transformLines,
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
      '}'
    ].join('\n');

    var fragmentShader = [
      'precision highp float;',
      'uniform sampler2D map;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec4 texel = texture2D(map, vUv);',
      '  if (texel.a < 0.01) discard;',
      '  gl_FragColor = texel;',
      '}'
    ].join('\n');

    THREE.ShaderMaterial.call(this, {
      uniforms: uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      side: params.side !== undefined ? params.side : THREE.DoubleSide,
      transparent: true,
      depthWrite: false
    });
  }
  BasicAnimationMaterial.prototype = Object.create(THREE.ShaderMaterial.prototype);
  BasicAnimationMaterial.prototype.constructor = BasicAnimationMaterial;

  THREE.BAS.BasicAnimationMaterial = BasicAnimationMaterial;
})(window.THREE);
