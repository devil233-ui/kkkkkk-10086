import decode from 'heic-decode'
import jpeg from 'jpeg-js'
import jsQR, { type QRCode } from 'jsqr'
import { PNG } from 'pngjs'

interface ImageDataLike {
  width: number
  height: number
  data: Uint8ClampedArray
}
interface ScanRegion {
  name: string
  x: number
  y: number
  w: number
  h: number
}

/** 本地强化二维码扫描器：先由上游扫描，复杂卡片或低对比度图片再走这里。 */
export class QRCodeScanner {
  static extractRegion (imageData: ImageDataLike, x: number, y: number, width: number, height: number): ImageDataLike {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const srcX = x + dx
        const srcY = y + dy
        if (srcX >= imageData.width || srcY >= imageData.height) continue
        const source = (srcY * imageData.width + srcX) * 4
        const target = (dy * width + dx) * 4
        data[target] = imageData.data[source] ?? 0
        data[target + 1] = imageData.data[source + 1] ?? 0
        data[target + 2] = imageData.data[source + 2] ?? 0
        data[target + 3] = imageData.data[source + 3] ?? 255
      }
    }
    return { width, height, data }
  }

  static enhanceContrast (imageData: ImageDataLike): ImageDataLike {
    const { width, height, data } = imageData
    const result = new Uint8ClampedArray(data.length)
    const histogram = new Array<number>(256).fill(0)
    for (let index = 0; index < data.length; index += 4) {
      const gray = Math.floor(0.299 * (data[index] ?? 0) + 0.587 * (data[index + 1] ?? 0) + 0.114 * (data[index + 2] ?? 0))
      histogram[gray] = (histogram[gray] ?? 0) + 1
    }
    const cdf = new Array<number>(256).fill(0)
    cdf[0] = histogram[0] ?? 0
    for (let index = 1; index < 256; index++) cdf[index] = (cdf[index - 1] ?? 0) + (histogram[index] ?? 0)
    const totalPixels = width * height
    const cdfMin = cdf.find(value => value > 0) ?? 0
    const denominator = Math.max(1, totalPixels - cdfMin)
    for (let index = 0; index < data.length; index += 4) {
      const gray = Math.floor(0.299 * (data[index] ?? 0) + 0.587 * (data[index + 1] ?? 0) + 0.114 * (data[index + 2] ?? 0))
      const next = Math.max(0, Math.min(255, Math.floor((((cdf[gray] ?? 0) - cdfMin) / denominator) * 255)))
      result[index] = next
      result[index + 1] = next
      result[index + 2] = next
      result[index + 3] = data[index + 3] ?? 255
    }
    return { width, height, data: result }
  }

  static binarize (imageData: ImageDataLike, threshold?: number): ImageDataLike {
    const { width, height, data } = imageData
    const result = new Uint8ClampedArray(data.length)
    if (threshold === undefined) {
      const histogram = new Array<number>(256).fill(0)
      for (let index = 0; index < data.length; index += 4) {
        const gray = Math.floor(0.299 * (data[index] ?? 0) + 0.587 * (data[index + 1] ?? 0) + 0.114 * (data[index + 2] ?? 0))
        histogram[gray] = (histogram[gray] ?? 0) + 1
      }
      const total = width * height
      let sum = 0
      for (let index = 0; index < 256; index++) sum += index * (histogram[index] ?? 0)
      let sumBackground = 0
      let weightBackground = 0
      let maxVariance = 0
      threshold = 0
      for (let value = 0; value < 256; value++) {
        weightBackground += histogram[value] ?? 0
        if (weightBackground === 0) continue
        const weightForeground = total - weightBackground
        if (weightForeground === 0) break
        sumBackground += value * (histogram[value] ?? 0)
        const meanBackground = sumBackground / weightBackground
        const meanForeground = (sum - sumBackground) / weightForeground
        const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
        if (variance > maxVariance) {
          maxVariance = variance
          threshold = value
        }
      }
    }
    for (let index = 0; index < data.length; index += 4) {
      const gray = Math.floor(0.299 * (data[index] ?? 0) + 0.587 * (data[index + 1] ?? 0) + 0.114 * (data[index + 2] ?? 0))
      const value = gray > threshold ? 255 : 0
      result[index] = value
      result[index + 1] = value
      result[index + 2] = value
      result[index + 3] = data[index + 3] ?? 255
    }
    return { width, height, data: result }
  }

  static sharpen (imageData: ImageDataLike): ImageDataLike {
    const { width, height, data } = imageData
    const result = new Uint8ClampedArray(data)
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let r = 0
        let g = 0
        let b = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const index = ((y + ky) * width + x + kx) * 4
            const weight = kernel[(ky + 1) * 3 + kx + 1] ?? 0
            r += (data[index] ?? 0) * weight
            g += (data[index + 1] ?? 0) * weight
            b += (data[index + 2] ?? 0) * weight
          }
        }
        const index = (y * width + x) * 4
        result[index] = Math.max(0, Math.min(255, r))
        result[index + 1] = Math.max(0, Math.min(255, g))
        result[index + 2] = Math.max(0, Math.min(255, b))
      }
    }
    return { width, height, data: result }
  }

  static tryRecognizeInRegion (imageData: ImageDataLike): string | null {
    const strategies: Array<{ enhance?: boolean, binarize?: boolean, sharpen?: boolean, inversionAttempts?: 'attemptBoth' }> = [
      {},
      { binarize: true },
      { sharpen: true },
      { enhance: true },
      { enhance: true, binarize: true },
      { binarize: true, sharpen: true },
      { inversionAttempts: 'attemptBoth' },
      { binarize: true, inversionAttempts: 'attemptBoth' }
    ]
    for (const strategy of strategies) {
      try {
        let processed = imageData
        if (strategy.sharpen) processed = this.sharpen(processed)
        if (strategy.enhance) processed = this.enhanceContrast(processed)
        if (strategy.binarize) processed = this.binarize(processed)
        const result: QRCode | null = jsQR(processed.data, processed.width, processed.height, strategy.inversionAttempts
          ? { inversionAttempts: strategy.inversionAttempts }
          : undefined)
        if (result?.data) return result.data
      } catch {
        // 该策略失败时继续尝试下一种图像变换。
      }
    }
    return null
  }

  static detectImageFormat (buffer: Buffer): 'png' | 'jpeg' | 'heic' | null {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(buffer.toString('ascii', 8, 12))) return 'heic'
    return null
  }

  static parsePNG (buffer: Buffer): ImageDataLike | null {
    try {
      const image = PNG.sync.read(buffer)
      return { width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) }
    } catch {
      return null
    }
  }

  static parseJPEG (buffer: Buffer): ImageDataLike | null {
    try {
      const image = jpeg.decode(buffer, { useTArray: true })
      return { width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) }
    } catch {
      return null
    }
  }

  static async parseHEIC (buffer: Buffer): Promise<ImageDataLike | null> {
    try {
      const image = await decode({ buffer })
      return { width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) }
    } catch {
      return null
    }
  }

  static async parseImageBuffer (buffer: Buffer): Promise<ImageDataLike | null> {
    switch (this.detectImageFormat(buffer)) {
      case 'png': return this.parsePNG(buffer)
      case 'jpeg': return this.parseJPEG(buffer)
      case 'heic': return await this.parseHEIC(buffer)
      default: return null
    }
  }

  static async scanFromBuffer (buffer: Buffer): Promise<string | null> {
    const imageData = await this.parseImageBuffer(buffer)
    if (!imageData) return null
    const { width, height } = imageData
    if (width <= 1024 && height <= 1024) {
      const wholeImage = this.tryRecognizeInRegion(imageData)
      if (wholeImage) return wholeImage
    }

    const small = Math.max(1, Math.min(400, Math.floor(Math.min(width, height) * 0.3)))
    const medium = Math.max(1, Math.min(600, Math.floor(Math.min(width, height) * 0.5)))
    const large = Math.max(1, Math.min(800, Math.floor(Math.max(width, height) * 0.6)))
    const card = Math.max(1, Math.min(700, width, height))
    const regions: ScanRegion[] = [
      { name: '右下角-卡片二维码', x: width - card, y: height - card, w: card, h: card },
      { name: '左上角-小', x: 0, y: 0, w: Math.min(small, width), h: Math.min(small, height) },
      { name: '右上角-小', x: Math.max(0, width - small), y: 0, w: Math.min(small, width), h: Math.min(small, height) },
      { name: '左下角-小', x: 0, y: Math.max(0, height - small), w: Math.min(small, width), h: Math.min(small, height) },
      { name: '右下角-小', x: Math.max(0, width - small), y: Math.max(0, height - small), w: Math.min(small, width), h: Math.min(small, height) },
      { name: '左上角-中', x: 0, y: 0, w: Math.min(medium, width), h: Math.min(medium, height) },
      { name: '右上角-中', x: Math.max(0, width - medium), y: 0, w: Math.min(medium, width), h: Math.min(medium, height) },
      { name: '左下角-中', x: 0, y: Math.max(0, height - medium), w: Math.min(medium, width), h: Math.min(medium, height) },
      { name: '左上角-大', x: 0, y: 0, w: Math.min(large, width), h: Math.min(large, height) },
      { name: '右上角-大', x: Math.max(0, width - large), y: 0, w: Math.min(large, width), h: Math.min(large, height) },
      { name: '左下角-大', x: 0, y: Math.max(0, height - large), w: Math.min(large, width), h: Math.min(large, height) },
      { name: '右下角-大', x: Math.max(0, width - large), y: Math.max(0, height - large), w: Math.min(large, width), h: Math.min(large, height) }
    ]

    for (const region of regions) {
      const result = this.tryRecognizeInRegion(this.extractRegion(imageData, region.x, region.y, region.w, region.h))
      if (result) return result
    }
    return null
  }
}
