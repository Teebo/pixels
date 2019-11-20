const path = require("path");
const fs = require("fs-extra");
const jimp = require("jimp");


const cropScreenshot = ({ image, cropConfig }) => {
  let x = 0; // horizontal
  let y = cropConfig.headerHeight;  // vertical

  let width = image.bitmap.width - x;
  let height = image.bitmap.height - y;

  // console.log(`${x} ${y} ${width} ${height}`);

  return image.crop(x, y, width, height);
};

const compareScreenshots = ({ image1, image2, threshold = 0.1, platform }) => {
  if(typeof image1 !== "string" || typeof image2 !== "string") {
    throw new Error("Should have passed paths to both images");
  }

  return new Promise((resolve, reject) => {
    Promise.all([
      jimp.read(image1),
      jimp.read(image2),
    ]).then((images) => {
      let png1;
      let png2;

      if(platform) {
        let cropConfig = {
          headerHeight: platform.headerHeight,
        };
        png1 = cropScreenshot({ image: images[0], cropConfig });
        png2 = cropScreenshot({ image: images[1], cropConfig });
      } else {
        png1 = images[0];
        png2 = images[1];
      }

      // Jimp also resizes the images if they are different dimensions so this is necessary
      if(png1.bitmap.width !== png2.bitmap.width || png1.bitmap.height !== png2.bitmap.height) {
        let errorMessage = `Image dimensions do not match (width x height): ${png1.bitmap.width}x${png1.bitmap.height} and ${png2.bitmap.width}x${png2.bitmap.height}`;
        reject(errorMessage);
        //throw new Error(errorMessage);
      } else {
        let diff = jimp.diff(png1, png2, threshold); // threshold ranges 0-1 (default: 0.1)
        // diff.image;   // a Jimp image showing differences
        // diff.percent; // the proportion of different pixels (0-1), where 0 means the images are pixel identical
        let retVal = {
          resultImage: diff.image,
          areDifferent: !!diff.percent,
        };

        resolve(retVal);
      }
    });
  });
};

compareScreenshots({
  image1: './Inkeddownload_2_LI.jpg',
  image2: './Inkeddownload_1_LI.jpg'
})
.then(
  (data) => {
    console.log(data);
  }
  )
  .catch(
    (err) => {
      console.log(err);
    }
  )
