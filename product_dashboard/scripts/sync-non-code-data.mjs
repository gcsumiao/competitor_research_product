import { cp, mkdir, stat } from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const sourceRoot = path.resolve(appRoot, "..", "NewProductCategory")
const targetRoot = path.join(appRoot, "data", "non_code_categories")

const COPY_PATHS = [
  "DMM/raw_data",
  "DMM/outputs",
  "Borescope/raw_data",
  "Borescope/outputs",
  "Borescope/25-11-25 Borescope V4.xlsx",
  "Thermal Imager/raw_data",
  "Thermal Imager/25-11-25 Thermal Imager V4.xlsx",
  "Thermal Imager/26-01-14 Thermal Imager.xlsx",
  "Thermal Imager/TI_Market_Analysis.xlsx",
  "Thermal Imager/TI_Market_Analysis_260113.xlsx",
  "Night Vision Monoculars/raw_data",
  "Night Vision Monoculars/outputs",
]

await mkdir(targetRoot, { recursive: true })

for (const relativePath of COPY_PATHS) {
  const sourcePath = path.join(sourceRoot, relativePath)
  const targetPath = path.join(targetRoot, relativePath)
  const sourceStats = await stat(sourcePath)

  if (sourceStats.isDirectory()) {
    await cp(sourcePath, targetPath, {
      recursive: true,
      force: true,
      filter: (entry) => path.basename(entry) !== ".DS_Store" && path.basename(entry) !== "._.DS_Store",
    })
    continue
  }

  await mkdir(path.dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath, { force: true })
}

console.log(`Synced deployable non-code data to ${targetRoot}`)
