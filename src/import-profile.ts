/**
 * ServiceSeeking profile scraper - ported from trade_simulation.py fetch_ss_profile_from_url().
 * Uses Cheerio (jQuery-like API) instead of BeautifulSoup.
 */
import * as cheerio from "cheerio";

export interface ScrapedProfile {
  success: boolean;
  source_url?: string;
  scraped_at?: string;
  error?: string;
  name?: string;
  description?: string;
  rating?: number;
  review_count?: number;
  location?: string;
  services?: string[];
  logo_url?: string | null;
  has_logo?: boolean;
  has_gallery?: boolean;
  has_reviews?: boolean;
  is_verified?: boolean;
  shows_insurance?: boolean;
  member_since?: string;
  times_hired?: number;
  response_time?: string;
  awards?: string[];
  abn?: string;
  license?: string;
  phone?: string;
  email?: string;
  owner_name?: string;
}

export async function fetchSSProfileFromUrl(url: string): Promise<ScrapedProfile> {
  try {
    if (!url.includes("serviceseeking.com.au")) {
      return { success: false, error: "Not a ServiceSeeking URL" };
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const pageText = $("body").text();

    const profile: ScrapedProfile = {
      success: true,
      source_url: url,
      scraped_at: new Date().toISOString(),
    };

    // ── Business Name ──
    let name: string | null = null;

    // Method 1: h1 tag
    const h1 = $("h1").first().text().trim();
    if (h1) name = h1;

    // Method 2: title tag
    if (!name) {
      const title = $("title").text().trim();
      if (title.includes("|")) name = title.split("|")[0].trim();
      else if (title.includes("-")) name = title.split("-")[0].trim();
    }

    // Method 3: URL slug
    if (!name || name === "Unknown Business") {
      const urlMatch = url.match(/\/profile\/\d+-(.+?)(?:\?|$)/);
      if (urlMatch) {
        name = urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }

    // Method 4: class-based
    if (!name) {
      const el = $("[class*='business'][class*='name'], [class*='profile'][class*='name'], [class*='company'][class*='name']").first();
      if (el.length) name = el.text().trim();
    }

    profile.name = name || "Unknown Business";

    // ── Description / About Us ──
    let description: string | null = null;

    // Method 1: id="about-us"
    const aboutDiv = $("#about-us");
    if (aboutDiv.length) {
      description = aboutDiv.text().replace(/\s+/g, " ").trim();
    }

    // Method 2: class containing "about"
    if (!description) {
      const aboutEl = $("[class*='about'][class*='us'], [class*='business'][class*='about'], [class*='profile'][class*='about']").first();
      if (aboutEl.length) description = aboutEl.text().replace(/\s+/g, " ").trim();
    }

    // Method 3: description class
    if (!description) {
      const descEl = $("[class*='description'], [class*='bio']").first();
      if (descEl.length) description = descEl.text().replace(/\s+/g, " ").trim();
    }

    // Method 4: long paragraph
    if (!description) {
      $("p").each((_, el) => {
        const text = $(el).text().trim();
        if (!description && text.length > 50 && text.includes(".")) {
          description = text;
        }
      });
    }

    if (description) {
      // Clean up redundant stats
      const cleanupPatterns = [
        /\s*Hired\s*:?\s*\d+\s*times?\s*/gi,
        /\s*Last\s+Quoted\s*:?\s*[^.]+\s*/gi,
        /\s*Response\s+time\s*:?\s*[^.]+\s*/gi,
        /\s*Member\s+since\s*:?\s*\d{4}\s*/gi,
        /\s*ABOUT\s+US\s*/gi,
        /\s*Quoted\s+on\s*:?\s*\d+\s*jobs?\s*/gi,
      ];
      for (const p of cleanupPatterns) description = description.replace(p, " ");
      description = description.replace(/\s+/g, " ").trim();
      if (description.length > 1500) description = description.substring(0, 1500) + "...";

      // Quality gate: reject junk descriptions
      const isJunk =
        description.length < 80 ||
        /^\w+$/.test(description) ||  // single word
        /^[\w\s,]+$/.test(description) && description.split(/\s+/).length <= 3 ||  // 1-3 plain words
        /^(painting|plumbing|electrical|carpentry|fencing|roofing|tiling|landscaping|cleaning)/i.test(description) && description.length < 100;

      if (!isJunk) {
        profile.description = description;
      }
      // If junk, leave description undefined so template placeholder is used
    }

    // ── Rating ──
    const ratingPatterns = [
      /(\d\.\d)\s*(?:\/\s*5|stars?|out of)/i,
      /(?:rating|rated)\s*:?\s*(\d\.\d)/i,
      /(\d\.\d)\s*(?=\s*\d+\s*reviews?)/i,
    ];
    for (const pattern of ratingPatterns) {
      const m = pageText.match(pattern);
      if (m) {
        const val = parseFloat(m[1]);
        if (val >= 1.0 && val <= 5.0) { profile.rating = val; break; }
      }
    }
    if (!profile.rating) {
      const wholeMatch = pageText.match(/([1-5])\s*(?:\/\s*5|stars?|out of 5)/i);
      if (wholeMatch) profile.rating = parseFloat(wholeMatch[1]);
    }

    // ── Review count ──
    const reviewMatch = pageText.match(/(\d+)\s*reviews?/i);
    if (reviewMatch) profile.review_count = parseInt(reviewMatch[1]);

    // ── Location ──
    const locationEl = $("[class*='location'], [class*='service'][class*='area'], [class*='suburb']").first();
    if (locationEl.length) profile.location = locationEl.text().trim();

    // ── Services ──
    const services: string[] = [];
    const seen = new Set<string>();

    // Method 1: "SERVICES WE PROVIDE" accordion panel (structured data - most reliable)
    $("#accordion .panel-body div[class*='col-']").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 2 && text.length < 100 && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        services.push(text);
      }
    });

    // Method 2: Also grab the parent category names from panel headings
    if (!services.length) {
      $("#accordion .panel-heading .label-category").each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2 && text.length < 100 && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
          services.push(text);
        }
      });
    }

    // Method 3: Fallback - class-based selectors
    if (!services.length) {
      $("[class*='service'], [class*='category'], [class*='skill']").each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2 && text.length < 100 && !seen.has(text.toLowerCase())) {
          seen.add(text.toLowerCase());
          services.push(text);
        }
      });
    }

    if (services.length) profile.services = services.slice(0, 30);

    // ── Logo ──
    const logoDiv = $("div.businesses-logo-cell");
    if (logoDiv.length) {
      const style = logoDiv.attr("style") || "";
      const bgMatch = style.match(/background-image:\s*url\(([^)]+)\)/i);
      if (bgMatch) {
        profile.logo_url = bgMatch[1].replace(/['"]/g, "");
        profile.has_logo = true;
      }
    }
    if (!profile.has_logo) {
      profile.has_logo = false;
      profile.logo_url = null;
    }

    // ── Gallery / Reviews flags ──
    profile.has_gallery = $("[class*='gallery'], [class*='portfolio'], [class*='photos']").length > 0;
    profile.has_reviews = (profile.review_count || 0) > 0;

    // ── Member since ──
    const memberMatch = pageText.match(/Member since\s*([A-Z][a-z]+\s+\d{4})/i);
    if (memberMatch) profile.member_since = memberMatch[1];

    // ── Times hired ──
    let hiredMatch = pageText.match(/Hired\s*:?\s*(\d+)\s*times?/i);
    if (!hiredMatch) hiredMatch = pageText.match(/(\d+)\s*times?\s*hired/i);
    if (hiredMatch) profile.times_hired = parseInt(hiredMatch[1]);

    // ── Response time ──
    const responseMatch = pageText.match(/Response\s*time\s*:?\s*(Within\s+(?:minutes?|hours?|a\s+day)|Same\s+day|\d+\s*(?:hour|minute|day)s?)/i);
    if (responseMatch) profile.response_time = responseMatch[1].trim();

    // ── Awards ──
    const awards: string[] = [];
    const seenAwards = new Set<string>();
    const awardPattern = /(20\d{2})\s*Top\s*(\d+)\s*(Painter|Plumber|Electrician|Builder|Cleaner)\s*in\s*([A-Za-z\s]+?)(?=20\d{2}|Identity|Valid|$)/gi;
    let awardMatch;
    while ((awardMatch = awardPattern.exec(pageText)) !== null) {
      const [, year, rank, trade, loc] = awardMatch;
      const location = loc.trim();
      const key = `${year}-${trade.toUpperCase()}-${location.toUpperCase()}`;
      if (!seenAwards.has(key) && location.length > 2) {
        seenAwards.add(key);
        awards.push(`${year} Top ${rank} ${trade.charAt(0).toUpperCase() + trade.slice(1).toLowerCase()} in ${location}`);
      }
    }
    if (awards.length) profile.awards = awards.slice(0, 5);

    // ── Verified ──
    profile.is_verified = $("[class*='verified'], [class*='badge'], [class*='credential']").length > 0;

    // ── ABN ──
    const abnMatch = pageText.match(/ABN\s*[-:]?\s*(\d{2}\s*\d{3}\s*\d{3}\s*\d{3})/i);
    if (abnMatch) {
      const raw = abnMatch[1].replace(/\s/g, "");
      if (raw.length === 11) {
        profile.abn = `${raw.slice(0, 2)} ${raw.slice(2, 5)} ${raw.slice(5, 8)} ${raw.slice(8, 11)}`;
      }
    }

    // ── License ──
    const licMatch = pageText.match(/(?:licence|license|lic)\s*(?:number|no\.?|#)?\s*[-:]?\s*(\d+[A-Za-z]*)/i);
    if (licMatch) profile.license = licMatch[1];

    // ── Phone ──
    const phonePatterns = [
      /\b(04\d{2}\s?\d{3}\s?\d{3})\b/,
      /\b(04\d{2}-\d{3}-\d{3})\b/,
      /\b(\(?0[2-9]\)?[\s-]?\d{4}[\s-]?\d{4})\b/,
    ];
    for (const pp of phonePatterns) {
      const pm = pageText.match(pp);
      if (pm) {
        profile.phone = pm[1].replace(/[\s\-()]/g, "");
        break;
      }
    }

    // ── Email ──
    const emailMatch = pageText.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    if (emailMatch) profile.email = emailMatch[1].toLowerCase();

    // ── Owner Name ──
    let ownerName: string | null = null;

    // Pattern 0: ficon-user icon
    const userIcon = $("i.ficon-user").first();
    if (userIcon.length) {
      const parentRow = userIcon.closest("div.row");
      if (parentRow.length) {
        const nameDiv = parentRow.find("div[class*='text-copy']").first();
        if (nameDiv.length) {
          const potential = nameDiv.text().trim();
          if (!/NSW|VIC|QLD|WA|SA|TAS|ACT|NT|Member since|Online/.test(potential)) {
            ownerName = potential;
          }
        }
      }
    }

    // Pattern 1: After "Online X ago"
    if (!ownerName) {
      const p1 = pageText.match(/(?:online|ago)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?=\s*[A-Z][a-z]+,?\s*(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT))/);
      if (p1) ownerName = p1[1].trim();
    }

    // Pattern 2: Before location
    if (!ownerName) {
      const p2 = pageText.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)(?=[A-Z][a-z]+,?\s*(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT))/);
      if (p2) ownerName = p2[1].trim();
    }

    // Pattern 3: "I'm [Name]"
    if (!ownerName) {
      const p3 = pageText.match(/(?:Hi,?\s*)?I['`]?m\s+([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]+)?)/i);
      if (p3) ownerName = p3[1].replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Pattern 4: "My name is"
    if (!ownerName) {
      const p4 = pageText.match(/[Mm]y name is\s+([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]+)?)/);
      if (p4) ownerName = p4[1].replace(/\b\w/g, (c) => c.toUpperCase());
    }

    // Pattern 5: Before "Member since"
    if (!ownerName) {
      const p5 = pageText.match(/([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]+)?)(?=\s*Member since)/);
      if (p5) ownerName = p5[1];
    }

    if (ownerName) profile.owner_name = ownerName;

    // ── Location fallback ──
    if (!profile.location) {
      const coverageIcon = $("i[class*='ficon-coverage']").first();
      if (coverageIcon.length) {
        const parentRow = coverageIcon.closest("div.row");
        if (parentRow.length) {
          const locDiv = parentRow.find("div[class*='text-copy']").first();
          if (locDiv.length) profile.location = locDiv.text().trim();
        }
      }
    }
    if (!profile.location) {
      const locMatch = pageText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)/);
      if (locMatch) profile.location = `${locMatch[1]}, ${locMatch[2]}`;
    }

    // ── Member since fallback ──
    if (!profile.member_since) {
      const calIcon = $("i[class*='ficon-calendar']").first();
      if (calIcon.length) {
        const parentRow = calIcon.closest("div.row");
        if (parentRow.length) {
          const dateDiv = parentRow.find("div[class*='text-copy']").first();
          if (dateDiv.length) {
            const text = dateDiv.text().trim();
            if (text.includes("Member since")) {
              profile.member_since = text.replace("Member since ", "");
            }
          }
        }
      }
    }

    // ── Insurance ──
    profile.shows_insurance = pageText.match(/insured|insurance|liability/i) !== null;

    return profile;
  } catch (e: any) {
    return { success: false, error: `Error parsing profile: ${e.message}` };
  }
}
