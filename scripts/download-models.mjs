import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import https from "node:https"

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(CURRENT_DIR, "..")
const MODEL_DIR = join(ROOT_DIR, "public", "models")
const MODEL_BASE_URL =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"

const MODEL_FILES = [
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_expression_model-weights_manifest.json",
  "face_expression_model-shard1"
]

mkdirSync(MODEL_DIR, { recursive: true })

await Promise.all(
  MODEL_FILES.map(async (fileName) => {
    const targetPath = join(MODEL_DIR, fileName)

    if (existsSync(targetPath)) {
      console.log(`model exists: ${fileName}`)
      return
    }

    await downloadFile(`${MODEL_BASE_URL}/${fileName}`, targetPath)
    console.log(`model downloaded: ${fileName}`)
  })
)

function downloadFile(url, targetPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume()
        downloadFile(response.headers.location, targetPath).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Failed to download ${url}. Status code: ${response.statusCode}`))
        return
      }

      const file = createWriteStream(targetPath)

      response.pipe(file)
      file.on("finish", () => {
        file.close(resolve)
      })
      file.on("error", (error) => {
        unlinkSync(targetPath)
        reject(error)
      })
    })

    request.on("error", reject)
  })
}
