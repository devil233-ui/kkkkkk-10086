import decode from "heic-decode"
import jpeg from "jpeg-js"
import jsQR from "jsqr"
import axios from "axios"
import { PNG } from "pngjs"

export class QRCodeScanner {
  static async scanFromUrl(imageUrl) {
    try {
      const response = await axios.get(imageUrl, { responseType: "arraybuffer" })
      const buffer = Buffer.from(response.data)
      return this.scanFromBuffer(buffer)
    } catch (error) {
      console.error("识别二维码时发生错误:", error)
      return null
    }
  }

  static extractRegion(imageData, x, y, width, height) {
    const newData = new Uint8ClampedArray(width * height * 4)
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        const srcX = x + dx
        const srcY = y + dy
        if (srcX >= imageData.width || srcY >= imageData.height) continue
        const srcIndex = (srcY * imageData.width + srcX) * 4
        const dstIndex = (dy * width + dx) * 4
        newData[dstIndex] = imageData.data[srcIndex]
        newData[dstIndex + 1] = imageData.data[srcIndex + 1]
        newData[dstIndex + 2] = imageData.data[srcIndex + 2]
        newData[dstIndex + 3] = imageData.data[srcIndex + 3]
      }
    }
    return { width, height, data: newData }
  }

  static enhanceContrast(imageData) {
    const { width, height, data } = imageData
    const newData = new Uint8ClampedArray(data.length)
    const histogram = new Array(256).fill(0)
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      histogram[gray]++
    }
    const cdf = new Array(256).fill(0)
    cdf[0] = histogram[0]
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + histogram[i]
    const totalPixels = width * height
    const cdfMin = cdf.find(v => v > 0) || 0
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      const newGray = Math.floor(((cdf[gray] - cdfMin) / (totalPixels - cdfMin)) * 255)
      newData[i] = newGray
      newData[i + 1] = newGray
      newData[i + 2] = newGray
      newData[i + 3] = data[i + 3]
    }
    return { width, height, data: newData }
  }

  static binarize(imageData, threshold) {
    const { width, height, data } = imageData
    const newData = new Uint8ClampedArray(data.length)
    if (threshold === undefined) {
      const histogram = new Array(256).fill(0)
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
        histogram[gray]++
      }
      const total = width * height
      let sum = 0
      for (let i = 0; i < 256; i++) sum += i * histogram[i]
      let sumB = 0, wB = 0, wF = 0, maxVariance = 0
      threshold = 0
      for (let t = 0; t < 256; t++) {
        wB += histogram[t]
        if (wB === 0) continue
        wF = total - wB
        if (wF === 0) break
        sumB += t * histogram[t]
        const mB = sumB / wB
        const mF = (sum - sumB) / wF
        const variance = wB * wF * (mB - mF) * (mB - mF)
        if (variance > maxVariance) {
          maxVariance = variance
          threshold = t
        }
      }
    }
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      const binary = gray > threshold ? 255 : 0
      newData[i] = binary
      newData[i + 1] = binary
      newData[i + 2] = binary
      newData[i + 3] = data[i + 3]
    }
    return { width, height, data: newData }
  }

  static sharpen(imageData) {
    const { width, height, data } = imageData
    const newData = new Uint8ClampedArray(data.length)
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let r = 0, g = 0, b = 0
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const idx = ((y + ky) * width + (x + kx)) * 4
            const k = kernel[(ky + 1) * 3 + (kx + 1)]
            r += data[idx] * k
            g += data[idx + 1] * k
            b += data[idx + 2] * k
          }
        }
        const idx = (y * width + x) * 4
        newData[idx] = Math.max(0, Math.min(255, r))
        newData[idx + 1] = Math.max(0, Math.min(255, g))
        newData[idx + 2] = Math.max(0, Math.min(255, b))
        newData[idx + 3] = data[idx + 3]
      }
    }
    for (let x = 0; x < width; x++) {
      const topIdx = x * 4
      const bottomIdx = ((height - 1) * width + x) * 4
      for (let c = 0; c < 4; c++) {
        newData[topIdx + c] = data[topIdx + c]
        newData[bottomIdx + c] = data[bottomIdx + c]
      }
    }
    for (let y = 0; y < height; y++) {
      const leftIdx = y * width * 4
      const rightIdx = (y * width + width - 1) * 4
      for (let c = 0; c < 4; c++) {
        newData[leftIdx + c] = data[leftIdx + c]
        newData[rightIdx + c] = data[rightIdx + c]
      }
    }
    return { width, height, data: newData }
  }

  static tryRecognizeInRegion(imageData, regionName) {
    const strategies = [
      { name: "默认", enhance: false, binarize: false, sharpen: false, options: undefined },
      { name: "二值化", enhance: false, binarize: true, sharpen: false, options: undefined },
      { name: "锐化", enhance: false, binarize: false, sharpen: true, options: undefined },
      { name: "增强对比度", enhance: true, binarize: false, sharpen: false, options: undefined },
      { name: "增强+二值化", enhance: true, binarize: true, sharpen: false, options: undefined },
      { name: "锐化+二值化", enhance: false, binarize: true, sharpen: true, options: undefined },
      { name: "attemptBoth", enhance: false, binarize: false, sharpen: false, options: { inversionAttempts: "attemptBoth" } },
      { name: "二值化+attemptBoth", enhance: false, binarize: true, sharpen: false, options: { inversionAttempts: "attemptBoth" } }
    ]
    for (const strategy of strategies) {
      try {
        let processedData = imageData
        if (strategy.sharpen) processedData = this.sharpen(processedData)
        if (strategy.enhance) processedData = this.enhanceContrast(processedData)
        if (strategy.binarize) processedData = this.binarize(processedData)
        const code = jsQR(processedData.data, processedData.width, processedData.height, strategy.options)
        if (code && code.data) return code.data
      } catch (err) {}
    }
    return null
  }

  static detectImageFormat(buffer) {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png"
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg"
    if (buffer.length >= 12) {
      const ftyp = buffer.toString("ascii", 4, 8)
      if (ftyp === "ftyp") {
        const brand = buffer.toString("ascii", 8, 12)
        if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heic"
      }
    }
    if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "gif"
    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "bmp"
    if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return "webp"
    return null
  }

  static parsePNG(buffer) {
    try {
      const png = PNG.sync.read(buffer)
      return { width: png.width, height: png.height, data: Uint8ClampedArray.from(png.data) }
    } catch (err) {
      return null
    }
  }

  static parseJPEG(buffer) {
    try {
      const decoded = jpeg.decode(buffer, { useTArray: true })
      return { width: decoded.width, height: decoded.height, data: Uint8ClampedArray.from(decoded.data) }
    } catch (err) {
      return null
    }
  }

  static async parseHEIC(buffer) {
    try {
      const decoded = await decode({ buffer })
      return { width: decoded.width, height: decoded.height, data: Uint8ClampedArray.from(decoded.data) }
    } catch (err) {
      return null
    }
  }

  static async parseImageBuffer(buffer) {
    try {
      const format = this.detectImageFormat(buffer)
      if (!format) return null
      switch (format) {
        case "png": return this.parsePNG(buffer)
        case "jpeg": return this.parseJPEG(buffer)
        case "heic": return await this.parseHEIC(buffer)
        default: return null
      }
    } catch (err) {
      return null
    }
  }

  static async scanFromBuffer(buffer) {
    try {
      const imageData = await this.parseImageBuffer(buffer)
      if (!imageData) return null
      const { width, height } = imageData

      if (width <= 1024 && height <= 1024) {
        const result = this.tryRecognizeInRegion(imageData, "全图")
        if (result) return result
      }

      const scanRegions = []
      const smallBlock = Math.min(400, Math.floor(Math.min(width, height) * 0.3))
      const mediumBlock = Math.min(600, Math.floor(Math.min(width, height) * 0.5))
      const largeBlock = Math.min(800, Math.floor(Math.max(width, height) * 0.6))
      const cardQrBlock = Math.min(700, width, height)

      scanRegions.push({ name: "右下角-卡片二维码", x: width - cardQrBlock, y: height - cardQrBlock, w: cardQrBlock, h: cardQrBlock })

      scanRegions.push({ name: "左上角-小", x: 0, y: 0, w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
      scanRegions.push({ name: "右上角-小", x: Math.max(0, width - smallBlock), y: 0, w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
      scanRegions.push({ name: "左下角-小", x: 0, y: Math.max(0, height - smallBlock), w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
      scanRegions.push({ name: "右下角-小", x: Math.max(0, width - smallBlock), y: Math.max(0, height - smallBlock), w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })

      scanRegions.push({ name: "左上角-中", x: 0, y: 0, w: Math.min(mediumBlock, width), h: Math.min(mediumBlock, height) })
      scanRegions.push({ name: "右上角-中", x: Math.max(0, width - mediumBlock), y: 0, w: Math.min(mediumBlock, width), h: Math.min(mediumBlock, height) })
      scanRegions.push({ name: "左下角-中", x: 0, y: Math.max(0, height - mediumBlock), w: Math.min(mediumBlock, width), h: Math.min(mediumBlock, height) })
      const blockW = Math.min(largeBlock, width)
      const blockH = Math.min(largeBlock, height)
      scanRegions.push({ name: "左上角-大", x: 0, y: 0, w: blockW, h: blockH })
      scanRegions.push({ name: "右上角-大", x: Math.max(0, width - blockW), y: 0, w: blockW, h: blockH })
      scanRegions.push({ name: "左下角-大", x: 0, y: Math.max(0, height - blockH), w: blockW, h: blockH })
      scanRegions.push({ name: "右下角-大", x: Math.max(0, width - blockW), y: Math.max(0, height - blockH), w: blockW, h: blockH })

      if (width > mediumBlock * 1.5) {
        scanRegions.push({ name: "顶部中-小", x: Math.floor((width - smallBlock) / 2), y: 0, w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
        if (height > mediumBlock * 1.5) scanRegions.push({ name: "底部中-小", x: Math.floor((width - smallBlock) / 2), y: Math.max(0, height - smallBlock), w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
      }

      if (height > mediumBlock * 1.5) {
        const middleY = Math.floor((height - smallBlock) / 2)
        scanRegions.push({ name: "左中-小", x: 0, y: middleY, w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
        if (width > mediumBlock * 1.5) scanRegions.push({ name: "右中-小", x: Math.max(0, width - smallBlock), y: middleY, w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
      }

      if (width > mediumBlock && height > mediumBlock) {
        scanRegions.push({ name: "中心-小", x: Math.floor((width - smallBlock) / 2), y: Math.floor((height - smallBlock) / 2), w: Math.min(smallBlock, width), h: Math.min(smallBlock, height) })
      }

      for (let i = 0; i < scanRegions.length; i++) {
        const region = scanRegions[i]
        const regionData = this.extractRegion(imageData, region.x, region.y, region.w, region.h)
        const result = this.tryRecognizeInRegion(regionData, region.name)
        if (result) return result
      }
      return null
    } catch (error) {
      console.error("解析图片时发生错误:", error)
      return null
    }
  }

  static isSupportedPlatform(qrContent) {
    const patterns = [
      /(https?:\/\/)?(www|v|jx|m|jingxuan)\.(douyin|iesdouyin)\.com/i,
      /https:\/\/aweme\.snssdk\.com\/aweme\/v1\/play/i,
      /(bilibili\.com|b23\.tv|t\.bilibili\.com|bili2233\.cn|\bBV[1-9a-zA-Z]{10}\b|\bav\d+\b)/i,
      /(快手.*快手|v\.kuaishou\.com|kuaishou\.com)/,
      /(xiaohongshu\.com|xhslink\.com)/
    ]
    return patterns.some(pattern => pattern.test(qrContent))
  }
}
