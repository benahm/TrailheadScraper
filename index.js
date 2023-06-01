import { chromium } from "playwright";
import { execSync } from "child_process"
import fs from "fs";
import Storage from "node-storage";
import express from "express";
import queue from "express-queue";
import timeout from 'connect-timeout';

const store = new Storage("store.json");

let refreshRequestInProgress = false;

(async () => {
  const app = express();
  app.use(queue({ activeLimit: 10, queuedLimit: 50 }));
  app.use(timeout('120s'))

  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext();

  /**
   * handle a request
   */
  const handleRequest = async (req, res) => {
    res.type("application/xml");

    console.log(`https://trailblazer.me/id/${req.params.id}`);

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

  app.get("/", (req, res) => {
    try{
      execSync("gh codespace ports visibility 8888:public --repo benahm/TrailheadScraper")
      res.send("Welcome to Trailhead Scraper, the API endpoint is now public")
    }catch(e){
      res.send("Welcome to Trailhead Scraper")
    }
  });

  app.get("/:id", (req, res) => {
    handleRequest(req, res);
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
    res.write("============================== start ==============================")
    res.write("\n")
    for (const id of ids) {
      res.write("Scraping " + id)
      await scrapTrailheadAcccount(context, id)
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


async function scrapTrailheadAcccount(context, id) {
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
    infos.name = await page.$eval(
      "lwc-tbui-card > div.heading > div.details > h1",
      (node) => node.innerText
    );
    const countList = await page.$$eval(
      "span > span.tally__count.tally__count_success",
      (nodes) => nodes.map((n) => n.innerText)
    );

    infos.badges = countList[0]
    infos.points = countList[1]
    infos.trails = countList[2]

    infos.levelText = await page.$eval(
      "lwc-tds-theme-provider > lwc-tbui-card > div:nth-child(1) > img",
      (node) => node.alt
    );
    infos.levelImage = await page.$eval(
      "lwc-tds-theme-provider > lwc-tbui-card > div:nth-child(1) > img",
      (node) => node.src
    );
    try {
      await page.waitForSelector(
        "#aura-directive-id-4 > c-lwc-certifications > c-lwc-card > article > c-lwc-card-header > div > header > div:nth-child(1) > div > h2"
      );
      infos.certifications = await page.$eval(
        "#aura-directive-id-4 > c-lwc-certifications > c-lwc-card > article > c-lwc-card-header > div > header > div:nth-child(1) > div > h2",
        (node) => node.innerText.split(" ")[0]
      );
    } catch (e) {
      infos.certifications = 0;
    }
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