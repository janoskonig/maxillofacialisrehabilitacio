declare module 'pizzip' {
  class PizZip {
    constructor(data?: Buffer | Uint8Array | string | ArrayBuffer);
    generate(options: { type: 'nodebuffer' | 'uint8array' | 'string' | 'blob' | 'base64' }): any;
  }
  export = PizZip;
}
