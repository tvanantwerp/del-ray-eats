const fs = require("fs");
const fsExtra = require("fs-extra");
const path = require("path");
const sharp = require("sharp");
const restaurants = require("../data/restaurants.json");
const images = require("../data/images.json");

const INPUT_DIR = path.resolve(__dirname, "../data/images");
const OUTPUT_DIR = path.resolve(__dirname, "../../public/images");
const FORMATS = images.formats;
const RESOLUTIONS = images.resolutions;

if (!fs.existsSync(OUTPUT_DIR)) {
  console.log(`Creating ${OUTPUT_DIR}`);
  fs.mkdirSync(OUTPUT_DIR);
} else {
  console.log(`Emptying ${OUTPUT_DIR}`);
  fsExtra.emptyDirSync(OUTPUT_DIR);
}

function pathToImage(filename) {
  return path.resolve(INPUT_DIR, `${filename}.png`);
}

function processImage(filename) {
  FORMATS.forEach((format) => {
    RESOLUTIONS.forEach((resolution) => {
      sharp(pathToImage(filename))
        .resize({ width: resolution[0], height: resolution[1] })
        .toFile(
          path.resolve(
            OUTPUT_DIR,
            `${filename}-${resolution[0]}-${resolution[1]}.${format}`
          ),
          (err, info) => {
            if (err) {
              console.error(`Error while processing ${filename}.png`, err);
            } else {
              console.log(
                `Success: ${filename}.png at ${info.width}x${info.height} in ${info.format} format`
              );
            }
          }
        );
    });
  });
}

restaurants.forEach((restaurant) => {
  const imagePath = path.resolve(INPUT_DIR, `${restaurant.slug}.png`);
  if (fs.existsSync(imagePath)) {
    processImage(restaurant.slug);
  }
});
