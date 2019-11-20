const path = require("path");
const fs = require("fs-extra");
const jimp = require("jimp");

/**
 * Extracts the session ID for Selenium webdriver used in browserstack and then passes it to callback function
 * @param driver - Selenium webdriver
 * @param callback - Callback function which will be called with the Browserstack's session ID
 */
exports.useSessionId = (driver, callback) => {
  driver.session_.then(function(sessionData) {
    callback(sessionData.id_);
  });
};

const errorsLogFileName = "browserstack.errors.log";
exports.errorsLogFileName = errorsLogFileName;

const cropScreenshot = ({ image, cropConfig }) => {
  let x = 0; // horizontal
  let y = cropConfig.headerHeight;  // vertical

  let width = image.bitmap.width - x;
  let height = image.bitmap.height - y;

  // console.log(`${x} ${y} ${width} ${height}`);

  return image.crop(x, y, width, height);
};

exports.cropScreenshot = cropScreenshot;

/**
 * Takes two images and compares them.
 * Returns a promise which resolves to an image that can be saved to a file.
 *
 * @param image1
 * @param image2 - images to compare (paths)
 * @param threshold - Matching threshold, ranges from 0 to 1. Smaller values make the comparison more sensitive. 0.1 by default.
 * @param antiAliasingOn -  If true, disables detecting and ignoring anti-aliased pixels. false by default.
 * @param isMobile - boolean (mobile screenshots need cropping)
 * @see https://github.com/mapbox/pixelmatch for more info
 */
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

exports.compareScreenshots = compareScreenshots;

const getPlatformConfig = (device, orientation) => {
  return mobileHeaders[device][orientation];
};

const assertBrowserScreenshotErrorPrefix = "Error detected in image:";
exports.assertBrowserScreenshotErrorPrefix = assertBrowserScreenshotErrorPrefix;

/**
 * Saves a screenshot from browser into specified location and asserts if it matches an existing file
 * @param browser - WebdriverIO's browser object
 * @param rootDir - path to the root directory of the spec being executed
 * @param fileName - name of the file (without extension) which needs to be saved/compared
 */
exports.assertBrowserScreenshot = (browser, rootDir, fileName) => {
  let isMobile = !!browser.desiredCapabilities.device;
  let osName = isMobile
    ? browser.desiredCapabilities.device
    : browser.desiredCapabilities.os;
  let osVersion = browser.desiredCapabilities.os_version;
  let browserName = browser.desiredCapabilities.browserName;
  let browserVersion = browser.desiredCapabilities.browser_version;
  let viewportSize = browser.getViewportSize();
  let vpSizeFolder = isMobile
    ? browser.desiredCapabilities.deviceOrientation
    : `${viewportSize.width}x${viewportSize.height}`;

  osVersion = osVersion.replace(/\./, '_');
  browserVersion = browserVersion ? browserVersion.replace(/\./, '_') : 'noVers';

  let filePathParams = [
    rootDir,
    "__browserstack",
    `${osName}_${osVersion}`,
    `${browserName}_${browserVersion}`,
  ];
  let platform = isMobile ? getPlatformConfig(browser.desiredCapabilities.device, vpSizeFolder) : null;

  //console.log("1 " + platform["headerHeight"]);

  // Only for desktop/Windows do we need to look at multiple resolutions
  filePathParams.push(vpSizeFolder);

  //console.log("1.5");

  let oldFilePath = path.join(...filePathParams, `${fileName}.png`);
  let newFilePath = path.join(...filePathParams, `${fileName}.new.png`);
  let diffFilePath = path.join(...filePathParams, `${fileName}.diff.png`);

  oldFilePath = oldFilePath.replace(/ /, '_');
  newFilePath = newFilePath.replace(/ /, '_');
  diffFilePath = diffFilePath.replace(/ /, '_');

  console.log(`\t\t\t* ${fileName}.png`);

  if(!fs.existsSync(oldFilePath)) {
    //console.log("2.1");
    browser.saveDocumentScreenshot(oldFilePath);  // generates folder path
    if(isMobile) {
      //console.log("2.1.a");
      browser.saveScreenshot(oldFilePath);
    }
    //console.log("2.1.b");
    fs.copySync(oldFilePath, newFilePath);
  } else {
    //console.log("2.2");
    if(isMobile) {
      // console.log("2.2.a");
      browser.saveScreenshot(newFilePath);
    } else {
      //console.log("2.2.b");
      browser.saveDocumentScreenshot(newFilePath);
    }
  }

  //console.log("3");

  compareScreenshots({ image1: oldFilePath, image2: newFilePath, platform })
  .then(({ areDifferent, resultImage }) => {
    //console.log("4");

    resultImage.write(diffFilePath);

    browserstackCheckEqual({
      expectedValue: areDifferent,
      actualValue: false,

      // we want the error message to contain path to the image relative to the project root folder
      // NOTE: we are relying on tests being ran from the project root, which works for path in "process.cwd()"
      errorMessage: `${assertBrowserScreenshotErrorPrefix} ${newFilePath.replace(process.cwd(), "")}`,
      browser: browser,
    });
  }).catch(error => { throw new Error(error) });
};

/**
 * Saves an error to log report file which contains all errors for all browserstack sessions
 * @param actualValue - Actual value for assert statement
 * @param expectedValue - Expected value for assert statement
 * @param checkTypeDescription - Description for the type check that we are doing (to help us place error in context)
 */
const browserstackCheckEqual = ({ expectedValue, actualValue, errorMessage, browser }) => {
  let isAssertPassed = actualValue === expectedValue;

  if(!isAssertPassed) {
    let fullErrorMessage = `Session ID: ${browser.requestHandler.sessionID} Message: ${errorMessage}\n`;
    logErrorMessage(fullErrorMessage);
  }
};

exports.browserstackCheckEqual = browserstackCheckEqual;

const desktopResolutions = [
  {
    width: 1366,
    height: 768,
  },
  {
    width: 1440,
    height: 900,
  },
  {
    width: 1680,
    height: 1050,
  },
  {
    width: 1920,
    height: 1080,
  },
];

const mobileHeaders = {
  "iPhone 7": {
    portrait: {
      headerHeight: 130,
    },
    landscape: {
      headerHeight: 90,
    },
  }
};

exports.mobileHeaders = mobileHeaders;

const storybookFrameId = "storybook-preview-iframe";

const callTestSpec = (testSpec, testSpecParams) => {
  console.log(`\t\t${testSpec.description}`);

  try {
    testSpec(testSpecParams);
  } catch(err) {
    let resolutionInfo = testSpecParams.device
      ? `${testSpecParams.device}x${testSpecParams.orientation}`
      : `${testSpecParams.resolution.width}x${testSpecParams.resolution.height}`;

    err.additionalMessage = `Test function named "${testSpec.description}" has failed at resolution: ${resolutionInfo}`;

    console.error(err.additionalMessage);

    throw err;
  }
};

const testAllResolutions = (testSpecs, resolutions = desktopResolutions) => {
  let osName = browser.desiredCapabilities.os;
  let osVersion = browser.desiredCapabilities.os_version;
  let browserName = browser.desiredCapabilities.browserName;
  let browserVersion = browser.desiredCapabilities.browser_version;

  if(osName === "Windows") {
    console.log(colors.green(`${osName} ${osVersion} x ${browserName} ${browserVersion}`));

    // Only for desktop/Windows do we need to go thru all resolutions
    resolutions.forEach((resolution) => {
      let testSpecParams = {
        resolution: {
          width: resolution.width,
          height: resolution.height,
        }
      };

      console.log(colors.green(`\t${testSpecParams.resolution.width}x${testSpecParams.resolution.height}`));

      // eslint-disable-next-line no-undef
      browser.setViewportSize({
        width: resolution.width,
        height: resolution.height,
      });

      testSpecs.forEach((testSpec) => {
        callTestSpec(testSpec, testSpecParams);
      });

    });
  } else {
    // For mobile devices we only need to run the spec once
    console.log(colors.green(`${browser.desiredCapabilities.device} ${osVersion}`));

    let testSpecParams = {
      device: 'mobile',
      orientation: browser.desiredCapabilities.deviceOrientation,
    };

    console.log(colors.green(`${testSpecParams.device}x${testSpecParams.orientation}`));

    testSpecs.forEach((testSpec) => {
      callTestSpec(testSpec, testSpecParams);
    });
  }
};

const logErrorMessage = (errorMessage) => fs.appendFileSync(errorsLogFileName, errorMessage);

exports.logErrorMessage = logErrorMessage;

/**
 * Sets up the story for Browserstack testing and takes a screenshot of initial state
 *
 * @param componentName
 * @param key - story key
 * @param URLs - story URL
 * @returns { object } - name prefix for this component and story
 */
const setupStory = ({ componentName, key, URL }) => {
  let imagePrefix = `${componentName}_${key}`;

  //console.log('url', URL);

  // eslint-disable-next-line no-undef
  browser.url(URL).waitUntil(function() {
    return browser.isVisible(`#${storybookFrameId}`);
  });

  // eslint-disable-next-line no-undef
  browser.frame(storybookFrameId);

  browser.waitUntil(function() {
    return browser.isVisible(`#root`);
  });

  return { imagePrefix };
};

exports.testAllResolutions = testAllResolutions;
exports.setupStory = setupStory;
