// TypeScript definitions for PlayStation Vita homebrew runtime environment

declare const DEBUG_CONTROLLERS: boolean;

interface Screen {
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

declare namespace Vita {
  function exit(): void;
  function readFile(path: string): Promise<Uint8Array | ArrayBuffer | string>;
  function writeFile(path: string, data: Uint8Array | string): Promise<boolean>;
  function memoryUsage(): { usedHeapSize?: number; totalHeapSize?: number };
}

declare namespace App {
  function exit(): void;
}

declare namespace Pads {
  function read(port: number): any;
}
