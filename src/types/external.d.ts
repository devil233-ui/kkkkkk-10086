declare module 'heic-decode' {
  interface HeicDecodeOptions {
    buffer: Buffer
  }

  interface HeicDecodeResult {
    width: number
    height: number
    data: Uint8Array
  }

  const decode: (options: HeicDecodeOptions) => Promise<HeicDecodeResult>
  export default decode
}

declare module 'pngjs' {
  interface PNGImage {
    width: number
    height: number
    data: Uint8Array
  }

  export class PNG {
    static sync: {
      read: (buffer: Uint8Array) => PNGImage
    }
  }
}
