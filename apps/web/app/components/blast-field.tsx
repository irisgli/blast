"use client";

import { useEffect, useRef } from "react";

/**
 * The field: a point, and the rings it reaches.
 *
 * This is the thing the tool measures, drawn. Rings leave the changed line and travel
 * across the section, thinning as they go, with one broad front every so often; the
 * headline stands inside their reach. It is the page's single ornament, so it is allowed
 * to be the memorable thing, and everything around it stays quiet.
 *
 * Raw WebGL rather than a scene library: the whole effect is one fragment shader and six
 * uniforms, and a 600 KB dependency for that is the wrong trade on a page whose argument
 * is that it knows what things cost. The canvas is transparent and the shader writes
 * premultiplied colour, so the same program draws blue rings on the white hero and white
 * rings on the blue closing band; the variant only picks the colour and the peak.
 *
 * Three things keep it honest. The origin is an element, not a coordinate: the rings
 * leave the diff card wherever the layout puts it, and are re-aimed when the card
 * streams in or the viewport changes. It stops drawing when it is off screen or the tab
 * is hidden. And under `prefers-reduced-motion` it draws one still frame and stops, so
 * the field is still there for someone who asked for less motion; it just does not move.
 *
 * Without WebGL the canvas stays blank. The layout never depends on it.
 */

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform float u_dpr;
uniform float u_time;
uniform vec2 u_origin;
uniform vec3 u_color;
uniform float u_peak;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 v = (gl_FragCoord.xy - u_origin) / u_dpr;
  float angle = atan(v.y, v.x);
  float d = length(v);

  // A trace, not a target: a low, slow wobble keeps the rings from being perfect circles.
  d += 3.0 * sin(angle * 5.0 + u_time * 0.35) + 2.0 * sin(angle * 11.0 - u_time * 0.2);

  // Thin rings travelling outward, 56 px apart, at 18 px a second.
  float phase = (d - u_time * 18.0) / 56.0;
  float ring = pow(0.5 + 0.5 * cos(phase * 6.2831853), 26.0);

  // The reach: intensity decays with distance from the change.
  float reach = exp(-d / 380.0);

  // One broad front every fourteen seconds or so, fading as it travels.
  float front = mod(u_time * 110.0, 1600.0);
  float pulse = exp(-pow((d - front) / 90.0, 2.0)) * 0.5 * exp(-front / 900.0);

  float a = (ring * 0.9 + pulse) * reach;

  // A clear floor right at the change, where the card sits.
  a *= smoothstep(24.0, 90.0, d);

  // Grain, re-rolled eight times a second so it reads as film rather than a texture.
  a += (hash(gl_FragCoord.xy + floor(u_time * 8.0)) - 0.5) * 0.035;

  a = clamp(a, 0.0, 1.0) * u_peak;
  gl_FragColor = vec4(u_color * a, a);
}
`;

const COLOR = {
  hero: [42 / 255, 91 / 255, 215 / 255],
  ink: [1, 1, 1],
} as const;

const PEAK = { hero: 0.24, ink: 0.16 } as const;

/** Device pixel ratio is capped: the shader is smooth at 1.5 and a 3x canvas buys nothing. */
const MAX_DPR = 1.5;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function BlastField({
  variant,
  origin,
  className,
}: {
  variant: keyof typeof COLOR;
  /** A selector, resolved inside the nearest section, for the element the rings leave from. */
  origin?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const section = canvas.closest("section") ?? canvas.parentElement;
    if (!section) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One triangle covers the clip space; a quad would need two.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const uDpr = uniform("u_dpr");
    const uTime = uniform("u_time");
    const uOrigin = uniform("u_origin");
    const uColor = uniform("u_color");
    const uPeak = uniform("u_peak");

    const [r, g, b] = COLOR[variant];
    gl.uniform3f(uColor, r, g, b);
    gl.uniform1f(uPeak, PEAK[variant]);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dpr = 1;
    let originX = 0;
    let originY = 0;

    const aim = () => {
      const bounds = canvas.getBoundingClientRect();
      const target = origin ? section.querySelector(origin) : null;
      // Without a card to leave from, the rings leave from where the card would be.
      let x = bounds.width * 0.72;
      let y = bounds.height * 0.42;
      if (target) {
        const box = target.getBoundingClientRect();
        x = box.left + box.width / 2 - bounds.left;
        y = box.top + box.height / 2 - bounds.top;
      }
      originX = x * dpr;
      // gl_FragCoord counts from the bottom edge.
      originY = (bounds.height - y) * dpr;
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform1f(uDpr, dpr);
      aim();
    };

    const draw = (seconds: number) => {
      gl.uniform1f(uTime, seconds);
      gl.uniform2f(uOrigin, originX, originY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    resize();

    if (reduce) {
      // One frame, a few seconds in so the rings have already reached the headline.
      draw(6);
      const still = new ResizeObserver(() => {
        resize();
        draw(6);
      });
      still.observe(section);
      return () => {
        still.disconnect();
      };
    }

    let frame = 0;
    let visible = true;
    let started = performance.now();
    let paused = 0;

    const loop = (now: number) => {
      draw((now - started) / 1000);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (frame) return;
      // Resume where the field left off rather than jumping ahead.
      if (paused) started += performance.now() - paused;
      paused = 0;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
      paused = performance.now();
    };
    const update = () => {
      if (visible && !document.hidden) start();
      else stop();
    };

    const onVisibility = () => update();
    document.addEventListener("visibilitychange", onVisibility);

    const seen = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        update();
      },
      { threshold: 0 },
    );
    seen.observe(canvas);

    const sized = new ResizeObserver(() => resize());
    sized.observe(section);

    // The card the rings leave from streams in behind its own boundary.
    const landed = new MutationObserver(() => aim());
    landed.observe(section, { childList: true, subtree: true });
    const settle = window.setTimeout(() => landed.disconnect(), 8000);

    const onLost = (event: Event) => {
      event.preventDefault();
      stop();
    };
    canvas.addEventListener("webglcontextlost", onLost);

    update();

    return () => {
      stop();
      seen.disconnect();
      sized.disconnect();
      landed.disconnect();
      window.clearTimeout(settle);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.deleteBuffer(buffer);
    };
  }, [variant, origin]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
