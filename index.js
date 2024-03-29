import { chromium } from "playwright";
import { execSync } from "child_process"
import fs from "fs";
import Storage from "node-storage";
import express from "express";
import timeout from 'connect-timeout';

const store = new Storage("store.json");

let refreshRequestInProgress = false;

(async () => {
  const app = express();
  app.use(timeout('120s'))

  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext();

  app.get("/", (req, res) => {
    try {
      execSync(`gh codespace ports visibility 8888:public --repo ${process.env.GITHUB_REPOSITORY}`)
      res.send("Welcome to Trailhead Scraper, the API endpoint is now public")
    } catch (e) {
      res.send("Welcome to Trailhead Scraper")
    }
  });

  app.get("/get/:id", (req, res) => {
    handleGetRequest(req, res);
  });

  app.get("/refresh", async (req, res) => {
    if (refreshRequestInProgress) {
      res.send("Refresh reequest is already in progress")
      return;
    }
    if (!req.query.ids) {
      res.send("You should pass the list of trailblazer ids as url param \n example ?ids=jdoe,foobar")
      return;
    }
    const ids = req.query.ids.split(",")
    refreshRequestInProgress = true
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write("===================================================================")
    res.write("\n")
    res.write("                   Welcome to Trailhead Scraper")
    res.write("\n")
    res.write("============================== start ==============================")
    res.write("\n")
    for (const id of ids) {
      res.write("Scraping " + id)
      await scrapTrailblazerProfile(context, id)
      res.write(" ✅" + "\n")
    }
    res.write("\n")
    res.write("============================== end ==============================")
    res.end();
    refreshRequestInProgress = false
  });

  app.listen(process.env.PORT || 8888, () => {
    console.log("the app is available at : http://localhost:8888");
  });
})();


/**
 * scrap a trailblazer profile
 */
async function scrapTrailblazerProfile(context, id) {
  if (fs.existsSync("store.json")) {
    fs.unlinkSync("store.json")
  }
  const page = await context.newPage();

  const scrapURL = `https://trailblazer.me/id/${id}`
  console.log(`scraping ${scrapURL}`);

  const infos = {};
  try {
    await page.goto(scrapURL, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(
      "lwc-tbui-card > div.heading > div.details > h1"
    );
    await page.waitForSelector(
      "span > span.tally__count.tally__count_success"
    );
    await page.waitForSelector(
      "lwc-tds-theme-provider > lwc-tbui-card > div:nth-child(1) > img"
    );
    // get name
    infos.name = await page.$eval(
      "lwc-tbui-card > div.heading > div.details > h1",
      (node) => node.innerText
    );
    const countList = await page.$$eval(
      "span > span.tally__count.tally__count_success",
      (nodes) => nodes.map((n) => n.innerText)
    );

    // replace , with space
    infos.badges = countList[0]?.replace(/,/g, ' ')
    infos.points = countList[1]?.replace(/,/g, ' ')
    infos.trails = countList[2]?.replace(/,/g, ' ')

    // get level text
    infos.levelText = await page.$eval(
      "lwc-tds-theme-provider > lwc-tbui-card > div:nth-child(1) > img",
      (node) => node.alt
    );
    // get level image
    infos.levelImage = await page.$eval(
      "lwc-tds-theme-provider > lwc-tbui-card > div:nth-child(1) > img",
      (node) => node.src
    );
    // get certifications
    try {
      await page.waitForSelector(
        "div > div.certifications-product-group-header > div.certifications-product-group-info > p.certification-product-subtitle :nth-child(2)"
      );
      infos.certifications = await page.$eval(
        "div > div.certifications-product-group-header > div.certifications-product-group-info > p.certification-product-subtitle :nth-child(2)",
        (node) => node.innerText.split(" ")[0]
      );
    } catch (e) {
      infos.certifications = await page.$eval(
        "article > header > div:nth-child(1) > div > h2",
        (node) => node.innerText.split(" ")[0]
      );
      // infos.certifications = 0;
    }
    // get superbadges
    try {
      await page.waitForSelector(
        "article > header > div:nth-child(1) > div > h2"
      );
      infos.superbadges = await page.$eval(
        "article > header > div:nth-child(1) > div > h2",
        (node) => {
          const value = node.innerText.split(" ")[0];
          if (isNaN(value)) return 0;
          return value;
        }
      );
    } catch (e) {
      infos.superbadges = 0;
    }

    console.log("name : ", infos.name);
    console.log("badges : ", infos.badges);
    console.log("points : ", infos.points);
    console.log("trails : ", infos.trails);
    console.log("levelText : ", infos.levelText);
    console.log("levelImage : ", infos.levelImage);
    console.log("certifications : ", infos.certifications);
    console.log("superbadges : ", infos.superbadges);

  } catch (e) {
    console.log("error", e);
  } finally {
    store.put(id, infos);
    page.close()
  }
}

/**
 * handle get request
 */
function handleGetRequest(req, res) {
  res.type("application/xml");

  console.log(`get : ${req.params.id}`);

  let infos = store.get(req.params.id);
  if (infos) {
    res.write("<result>");
    res.write(`<div class='result name'>${infos.name}</div>`);
    res.write(`<div class='result badges'>${infos.badges}</div>`);
    res.write(`<div class='result points'>${infos.points}</div>`);
    res.write(`<div class='result trails'>${infos.trails}</div>`);
    res.write(`<div class='result leveltext'>${infos.levelText}</div>`);
    res.write(`<div class='result levelimage'>${infos.levelImage}</div>`);
    res.write(
      `<div class='result certifications'>${infos.certifications}</div>`
    );
    res.write(`<div class='result superbadges'>${infos.superbadges}</div>`);
    res.write("</result>");
    res.end();
  } else {
    res.end();
  }
};