'use client';

import { useEffect, useRef, useState, memo } from 'react';

interface AsciiGlobeProps {
  className?: string;
  size?: number;
  speed?: number;
  textureUrl?: string;
}

const CHARS = ' .,-<>09$#@';

function AsciiGlobe({
  className = '',
  size = 40,
  speed = 0.02,
  textureUrl = '/textures/earth.png',
}: AsciiGlobeProps) {
  const [frame, setFrame] = useState('');
  const containerRef = useRef<HTMLPreElement>(null);
  const angleRef = useRef(0);
  const textureDataRef = useRef<ImageData | null>(null);
  const isVisibleRef = useRef(true);
  const rafRef = useRef<number>(0);
  const lastRenderRef = useRef(0);
  const hasRenderedOnceRef = useRef(false);

  const width = size * 2;
  const height = size;
  const radius = size / 2 - 1;
  const aspectRatio = 0.64;

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        textureDataRef.current = ctx.getImageData(0, 0, img.width, img.height);
      }
    };
    img.src = textureUrl;
  }, [textureUrl]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        isVisibleRef.current = entries[0].isIntersecting;
      },
      { threshold: 0.1 }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const FPS = 12;
    const frameInterval = 1000 / FPS;
    const STEP = 0.006;

    const getTexturePixel = (lat: number, lon: number): number => {
      const data = textureDataRef.current;
      if (!data) return 0.5;

      const texWidth = data.width;
      const texHeight = data.height;

      const u = (lon + Math.PI) / (2 * Math.PI);
      const v = 1 - (lat + Math.PI / 2) / Math.PI;

      const texX = Math.floor(u * texWidth) % texWidth;
      const texY = Math.floor(v * texHeight) % texHeight;

      const idx = (texY * texWidth + texX) * 4;
      return (data.data[idx] + data.data[idx + 1] + data.data[idx + 2]) / 765;
    };

    const render = (timestamp: number) => {
      rafRef.current = requestAnimationFrame(render);

      if (!textureDataRef.current) return;

      if (timestamp - lastRenderRef.current < frameInterval) return;
      lastRenderRef.current = timestamp;

      if (hasRenderedOnceRef.current && !isVisibleRef.current) return;
      hasRenderedOnceRef.current = true;

      const A = angleRef.current;
      angleRef.current += speed * 0.5;

      const outputSize = width * height;
      const output = new Array(outputSize).fill(' ');
      const zBuffer = new Float32Array(outputSize).fill(-Infinity);

      const cosA = Math.cos(A);
      const sinA = Math.sin(A);
      const halfWidth = width / 2;
      const halfHeight = height / 2;

      for (let phi = -Math.PI; phi < Math.PI; phi += STEP) {
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        for (let theta = -Math.PI / 2; theta <= Math.PI / 2; theta += STEP) {
          const cosTheta = Math.cos(theta);
          const sinTheta = Math.sin(theta);

          const x = cosTheta * cosPhi;
          const y = sinTheta;
          const z = cosTheta * sinPhi;

          const x1 = x * cosA - z * sinA;
          const z1 = x * sinA + z * cosA;

          if (z1 < 0) continue;

          const px = Math.floor(halfWidth + x1 * radius);
          const py = Math.floor(halfHeight - y * radius * aspectRatio);
          const idx = px + py * width;

          if (px >= 0 && px < width && py >= 0 && py < height && z1 > zBuffer[idx]) {
            zBuffer[idx] = z1;

            const brightness = getTexturePixel(theta, phi);
            const light = z1 * 0.6 + 0.4;
            const finalBrightness = 0.2 + brightness * light * 0.8;

            const charIdx = Math.floor(finalBrightness * (CHARS.length - 1));
            output[idx] = CHARS[Math.max(0, Math.min(CHARS.length - 1, charIdx))];
          }
        }
      }

      let result = '';
      for (let j = 0; j < height; j++) {
        const rowStart = j * width;
        for (let i = 0; i < width; i++) {
          result += output[rowStart + i];
        }
        result += '\n';
      }

      setFrame(result);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size, speed, width, height, radius, aspectRatio]);

  return (
    <pre
      ref={containerRef}
      className={`font-mono text-xs leading-none select-none ${className}`}
      style={{ letterSpacing: '0', lineHeight: '0.9' }}
    >
      {frame}
    </pre>
  );
}

export default memo(AsciiGlobe);
