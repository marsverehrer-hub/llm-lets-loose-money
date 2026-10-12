import type { DatasetDef } from '../types';
// OWNER: data agent. Static dataset catalogue, 2017 -> 2035 (GAME_DESIGN.md §14). tokensB = billions of unique tokens.
// Rules the rest of the code relies on:
// - Exactly ONE cost-0 set with unlockYear <= 2017 and no research gate (state.ts gives it to the player at start).
// - open: free, low quality, no legal risk. scrape: cheap-ish, high legal risk. userdata: free, needs a live product.
// - license / partnership: `cost` is the signing fee, `annualFee` is paid up front for year one, then daily from year two.
// - contestedBy ids must exist in data/competitors.ts. requiresResearch ids must exist in data/research.ts (or §13.3 lists).
// - Eras: 2017 sets are 1-30B tokens at $0-200k; 2022 sets 100B-5T at $1-50M; 2030 sets 10-200T up to $5B.
export const DATASETS: DatasetDef[] = [
  // ======================================================================================
  // WEB
  // ======================================================================================
  {
    id: 'scrawl_sample', name: 'Common Scrawl Sample', kind: 'web', acquisition: 'open', domain: 'general',
    tokensB: 5, quality: 0.45, cost: 0, legalRisk: 0.1, unlockYear: 2017, freshnessYear: 2017,
    capBonus: { multilingual: 1 },
    flavor: 'A random 5% of the internet. The other 95% is mostly cat pictures and SEO.',
  },
  {
    id: 'wikipediaish', name: 'Wikipedia-ish', kind: 'web', acquisition: 'purchase', domain: 'general',
    tokensB: 3, quality: 0.85, cost: 20_000, legalRisk: 0.05, unlockYear: 2017,
    capBonus: { multilingual: 2, knowledge: 1 },
    flavor: 'Well-cited, mostly. Edit wars included at no extra charge.',
  },
  {
    id: 'forum_archive', name: 'Forum Archive Mk.II', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 30, quality: 0.35, cost: 60_000, legalRisk: 0.4, reputationRisk: 0.1, unlockYear: 2018,
    flavor: 'Every thread that began with "does anyone else". Many people did.',
  },
  {
    id: 'recipe_attic', name: 'Recipe Blog Attic', kind: 'web', acquisition: 'scrape', domain: 'creative',
    tokensB: 12, quality: 0.4, cost: 20_000, legalRisk: 0.2, unlockYear: 2018,
    flavor: 'Recipes that begin with three paragraphs about a grandmother. The grandmother is fictional.',
  },
  {
    id: 'tos_corpus', name: 'Terms of Service Corpus', kind: 'web', acquisition: 'open', domain: 'legal',
    tokensB: 3, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2018,
    flavor: 'Every ToS you did not read, and then some. Surprisingly readable. Still never read.',
  },
  {
    id: 'gov_portal_dump', name: 'Government Portal Dump', kind: 'web', acquisition: 'open', domain: 'legal',
    tokensB: 8, quality: 0.5, cost: 0, legalRisk: 0, unlockYear: 2018,
    flavor: 'Every .gov page, most of them PDFs from 2009 with a logo in the corner.',
  },
  {
    id: 'edgar_sec', name: 'EDGAR-ish SEC Filings', kind: 'web', acquisition: 'open', domain: 'finance',
    tokensB: 12, quality: 0.55, cost: 0, legalRisk: 0, unlockYear: 2018,
    flavor: 'Annual reports with 400 pages of risk factors. Your model learns to hedge everything.',
  },
  {
    id: 'yellow_pages_reimagined', name: 'Yellow Pages, Reimagined', kind: 'web', acquisition: 'purchase', domain: 'general',
    tokensB: 4, quality: 0.5, cost: 40_000, legalRisk: 0.05, unlockYear: 2018,
    flavor: 'Plumbers, dentists and one sovereign wealth fund, all listed under "Other".',
  },
  {
    id: 'wayback_partial', name: 'The Wayback Machine (Partial)', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 400, quality: 0.35, cost: 800_000, legalRisk: 0.5, unlockYear: 2019, freshnessYear: 2019,
    flavor: 'Snapshots of pages deleted for good reasons, and a few deleted for no reason at all.',
  },
  {
    id: 'parliament_transcripts', name: 'Parliamentary Transcripts (All of Them)', kind: 'web', acquisition: 'open', domain: 'legal',
    tokensB: 6, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2019,
    flavor: 'Points of order, all of them. Several hours of "I refer the honourable member to the previous answer".',
  },
  {
    id: 'common_scrawl_full', name: 'Common Scrawl (Full Crawl)', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 180, quality: 0.4, cost: 500_000, legalRisk: 0.45, reputationRisk: 0.05, unlockYear: 2019,
    capBonus: { multilingual: 3, knowledge: 1 },
    flavor: 'The whole internet, compressed. The compression is mostly spam.',
  },
  {
    id: 'dedup_scrawl', name: 'MinHashed Common Scrawl', kind: 'web', acquisition: 'purchase', domain: 'general',
    tokensB: 300, quality: 0.62, cost: 3_000_000, legalRisk: 0.35, unlockYear: 2022, requiresResearch: 'minhash_dedup',
    flavor: 'The same crawl, but every near-duplicate has been politely removed. Only 4,000 copies of "Lorem ipsum" remain.',
  },
  {
    id: 'news_crawl_2020', name: 'Mega News Crawl 2020', kind: 'web', acquisition: 'scrape', domain: 'news',
    tokensB: 900, quality: 0.45, cost: 3_000_000, legalRisk: 0.4, reputationRisk: 0.1, unlockYear: 2020, freshnessYear: 2020,
    flavor: 'Every headline from one very long year. Everyone in the training run is tired.',
  },
  {
    id: 'local_obituaries', name: 'Local Obituary Pages', kind: 'web', acquisition: 'scrape', domain: 'news',
    tokensB: 15, quality: 0.7, cost: 400_000, legalRisk: 0.15, unlockYear: 2020,
    flavor: 'Mostly kind. A few are about people who are not dead. Oops.',
  },
  {
    id: 'podcast_show_notes', name: 'Podcast Show Notes Archive', kind: 'web', acquisition: 'scrape', domain: 'audio',
    tokensB: 60, quality: 0.5, cost: 3_000_000, legalRisk: 0.25, unlockYear: 2022,
    flavor: 'Show notes written by interns who had not listened to the show.',
  },
  {
    id: 'corporate_blogs', name: 'Corporate Blog Autotune', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 1200, quality: 0.3, cost: 2_000_000, legalRisk: 0.2, unlockYear: 2021,
    flavor: 'Ten thousand posts titled "5 Ways AI Is Changing Everything". Several are the same post.',
  },
  {
    id: 'review_sites', name: 'Shopping Reviews (Verified-ish)', kind: 'web', acquisition: 'scrape', domain: 'finance',
    tokensB: 200, quality: 0.35, cost: 1_000_000, legalRisk: 0.45, reputationRisk: 0.25, unlockYear: 2021,
    flavor: 'Five stars, almost all of them from someone\'s cousin. Verified purchase, probably.',
  },
  {
    id: 'syndicated_newspapers', name: 'Syndicated Newspaper Archive', kind: 'web', acquisition: 'license', domain: 'news',
    tokensB: 250, quality: 0.85, cost: 2_000_000, annualFee: 4_000_000, legalRisk: 0.1, unlockYear: 2022, freshnessYear: 2022,
    flavor: 'Forty years of local news under one licence, and one editor who is still angry about the font.',
  },
  {
    id: 'global_wiki_translations', name: 'Global Wiki Translations', kind: 'web', acquisition: 'open', domain: 'multilingual',
    tokensB: 40, quality: 0.5, cost: 0, legalRisk: 0, unlockYear: 2023, capBonus: { multilingual: 4 },
    flavor: 'Wikipedia in 300 languages, machine-translated into the rest. Very confident. Occasionally about the wrong town.',
  },
  {
    id: 'fineweb_ish', name: 'FineWebbish', kind: 'web', acquisition: 'purchase', domain: 'general',
    tokensB: 2000, quality: 0.7, cost: 8_000_000, legalRisk: 0.3, unlockYear: 2023, requiresResearch: 'data_filtering',
    capBonus: { multilingual: 3, knowledge: 2 },
    flavor: 'Two trillion tokens, filtered until only the good stuff remains. Mostly.',
  },
  {
    id: 'news_publisher_coalition', name: 'News Publisher Coalition Licence', kind: 'web', acquisition: 'partnership', domain: 'news',
    tokensB: 1500, quality: 0.88, cost: 20_000_000, annualFee: 15_000_000, legalRisk: 0.05, reputationRisk: 0.05,
    unlockYear: 2023, exclusive: true, contestedBy: ['openaye', 'deepseekers'], freshnessYear: 2023,
    flavor: 'Every coalition member agreed. One of them has a lawyer who reads everything twice.',
  },
  {
    id: 'indic_web_crawl', name: 'Indic Web Crawl', kind: 'web', acquisition: 'purchase', domain: 'multilingual',
    tokensB: 2500, quality: 0.5, cost: 12_000_000, legalRisk: 0.3, unlockYear: 2024, capBonus: { multilingual: 5 },
    flavor: 'Twenty-two scripts, one shared ecosystem of spam in all of them.',
  },
  {
    id: 'wiki_enterprise_mirror', name: 'Wikipedia Enterprise Mirror (Fresh)', kind: 'web', acquisition: 'license', domain: 'general',
    tokensB: 300, quality: 0.9, cost: 1_000_000, annualFee: 3_000_000, legalRisk: 0.02, unlockYear: 2024, freshnessYear: 2024,
    flavor: 'The same articles, updated daily, with a sponsor banner nobody can see.',
  },
  {
    id: 'search_index_scrape', name: 'Search Engine Index Scrape (Unofficial)', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 4000, quality: 0.5, cost: 25_000_000, legalRisk: 0.6, reputationRisk: 0.2, unlockYear: 2025,
    flavor: 'A search engine\'s index, copied by someone who promised not to. They did not promise very hard.',
  },
  {
    id: 'exchange_tick_partnership', name: 'Exchange Tick Feed Partnership', kind: 'web', acquisition: 'partnership', domain: 'finance',
    tokensB: 2000, quality: 0.9, cost: 40_000_000, annualFee: 30_000_000, legalRisk: 0.1, reputationRisk: 0.1,
    unlockYear: 2026, exclusive: true, contestedBy: ['openaye', 'deepmined', 'mistrial'], freshnessYear: 2026,
    flavor: 'Every trade, timestamped to the microsecond. None of it is financial advice. Legally.',
  },
  {
    id: 'common_scrawl_2026', name: 'Common Scrawl 2026 (Tuesday Edition)', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 8000, quality: 0.55, cost: 40_000_000, legalRisk: 0.5, unlockYear: 2026, freshnessYear: 2026,
    flavor: 'Crawled on a Tuesday, which the crawler considers the best day for crawling.',
  },
  {
    id: 'open_web_chlorinated', name: 'The Open Web, Lightly Chlorinated', kind: 'web', acquisition: 'open', domain: 'general',
    tokensB: 20_000, quality: 0.35, cost: 0, legalRisk: 0, unlockYear: 2026, freshnessYear: 2026,
    flavor: 'Everything that was public and is now mostly public. The chlorine is for the spam.',
  },
  {
    id: 'leaked_internal_wiki', name: 'Leaked Internal Wiki', kind: 'web', acquisition: 'scrape', domain: 'general',
    tokensB: 600, quality: 0.9, cost: 30_000_000, legalRisk: 0.9, reputationRisk: 0.9, unlockYear: 2025,
    freshnessYear: 2025, secret: true,
    flavor: 'A competitor\'s internal wiki. Page one says "Do Not Train On This". Page two is a carrot cake recipe.',
  },
  {
    id: 'wikipedia_talk_pages', name: 'Wikipedia Talk Pages', kind: 'web', acquisition: 'open', domain: 'dialogue',
    tokensB: 9, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2021,
    flavor: 'Where the real arguments happen. Forty messages about a comma, then an apology in the wrong section.',
  },

  // ======================================================================================
  // BOOKS
  // ======================================================================================
  {
    id: 'bookcorpse', name: 'BookCorpse', kind: 'books', acquisition: 'scrape', domain: 'creative',
    tokensB: 6, quality: 0.75, cost: 150_000, legalRisk: 0.6, unlockYear: 2017,
    scoreBonus: { reasoning: 2 }, capBonus: { knowledge: 1 },
    flavor: 'Thousands of novels, none of which were licensed. Very literary.',
  },
  {
    id: 'gutenbergish', name: 'Public Domain Stacks', kind: 'books', acquisition: 'purchase', domain: 'creative',
    tokensB: 2, quality: 0.7, cost: 30_000, legalRisk: 0, unlockYear: 2017,
    capBonus: { knowledge: 1 },
    flavor: 'Everything old enough to be legally boring. Lots of whaling.',
  },
  {
    id: 'poetry_unreviewed', name: 'Poetry Corpus (Unreviewed)', kind: 'books', acquisition: 'open', domain: 'creative',
    tokensB: 1, quality: 0.4, cost: 0, legalRisk: 0, unlockYear: 2018,
    flavor: 'Haiku, villanelles, and one sonnet that is secretly a tax form.',
  },
  {
    id: 'fan_fiction_archive', name: 'Fan Fiction Archive', kind: 'books', acquisition: 'scrape', domain: 'creative',
    tokensB: 35, quality: 0.5, cost: 200_000, legalRisk: 0.35, unlockYear: 2018, capBonus: { knowledge: 0.5, chat: 1 },
    flavor: 'Forty million unfinished crossovers and one very long story about a dragon\'s tax return.',
  },
  {
    id: 'pubmedley', name: 'PubMedley', kind: 'books', acquisition: 'license', domain: 'medical',
    tokensB: 30, quality: 0.85, cost: 1_500_000, annualFee: 1_000_000, legalRisk: 0.1, unlockYear: 2019,
    capBonus: { knowledge: 2 },
    flavor: 'Every abstract, all 36 million, one of which is about your cousin.',
  },
  {
    id: 'encyclopedia_nobody_asked', name: 'Encyclopedia of Things Nobody Asked About', kind: 'books', acquisition: 'purchase', domain: 'general',
    tokensB: 5, quality: 0.7, cost: 80_000, legalRisk: 0.05, unlockYear: 2019, capBonus: { knowledge: 1 },
    flavor: 'Twelve volumes on the history of the doorknob. The index is mostly doorknobs.',
  },
  {
    id: 'cookbook_conglomerate', name: 'Cookbook Conglomerate', kind: 'books', acquisition: 'purchase', domain: 'creative',
    tokensB: 3, quality: 0.6, cost: 60_000, legalRisk: 0.1, unlockYear: 2019,
    flavor: 'Two hundred chicken recipes, and a foreword in every single one.',
  },
  {
    id: 'tax_code_annotated', name: 'Tax Code, Annotated (Unofficially)', kind: 'books', acquisition: 'purchase', domain: 'finance',
    tokensB: 4, quality: 0.85, cost: 150_000, legalRisk: 0.05, unlockYear: 2019, capBonus: { knowledge: 1, reasoning: 0.5 },
    flavor: 'Every clause footnoted by someone with strong opinions and a deadline.',
  },
  {
    id: 'audiobook_transcripts', name: 'Audiobook Transcripts (LibriVox-ish)', kind: 'books', acquisition: 'open', domain: 'audio',
    tokensB: 9, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2019,
    flavor: 'Volunteers reading public domain classics in a voice that is always slightly worried.',
  },
  {
    id: 'shadow_library', name: 'Shadow Library (do not ask)', kind: 'books', acquisition: 'scrape', domain: 'creative',
    tokensB: 90, quality: 0.7, cost: 1_200_000, legalRisk: 0.9, reputationRisk: 0.5, unlockYear: 2019,
    flavor: 'Do not ask where it came from. The index is a single text file named "books2.txt".',
  },
  {
    id: 'philosophy_seminars', name: 'Philosophy Seminar Transcripts', kind: 'books', acquisition: 'open', domain: 'general',
    tokensB: 2, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2020,
    flavor: 'Three hours per transcript of "but what do we actually mean by mean".',
  },
  {
    id: 'law_review_scrape', name: 'Law Review Scrape', kind: 'books', acquisition: 'scrape', domain: 'legal',
    tokensB: 12, quality: 0.8, cost: 500_000, legalRisk: 0.6, unlockYear: 2021,
    flavor: 'Academic footnotes, the best part. Also the only part anyone reads.',
  },
  {
    id: 'major_publisher_backlist', name: 'Major Publisher Backlist Licence', kind: 'books', acquisition: 'license', domain: 'creative',
    tokensB: 150, quality: 0.8, cost: 4_000_000, annualFee: 6_000_000, legalRisk: 0.05, unlockYear: 2021,
    flavor: 'Five houses, one spreadsheet, and a clause about "machine-adjacent uses".',
  },
  {
    id: 'library_scans_ocr', name: 'Municipal Library Scans (OCR\'d Twice)', kind: 'books', acquisition: 'purchase', domain: 'general',
    tokensB: 45, quality: 0.5, cost: 900_000, legalRisk: 0.15, unlockYear: 2021,
    flavor: 'OCR\'d twice, so every "rn" is now "m" and every "m" is a question.',
  },
  {
    id: 'case_law_bulk', name: 'Case Law Bulk Download', kind: 'books', acquisition: 'open', domain: 'legal',
    tokensB: 8, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2022,
    flavor: 'Every court opinion ever written, including one about a goat in a parking lot.',
  },
  {
    id: 'textbook_library_lease', name: 'Textbook Library Lease', kind: 'books', acquisition: 'license', domain: 'science',
    tokensB: 20, quality: 0.85, cost: 1_000_000, annualFee: 800_000, legalRisk: 0.1, unlockYear: 2020,
    flavor: 'Calculus, six editions, all with the same typo on page 214.',
  },
  {
    id: 'manga_scans', name: 'Manga Magazine Scans (Tentative)', kind: 'books', acquisition: 'scrape', domain: 'creative',
    tokensB: 6, quality: 0.6, cost: 120_000, legalRisk: 0.7, reputationRisk: 0.1, unlockYear: 2022,
    flavor: 'Panels read right to left, which the model respects and the lawyers do not.',
  },
  {
    id: 'picture_books_ethical', name: "Children's Picture Books (Ethically Sourced, Mostly)", kind: 'books', acquisition: 'purchase', domain: 'creative',
    tokensB: 5, quality: 0.7, cost: 800_000, legalRisk: 0.1, unlockYear: 2022, capBonus: { chat: 1 },
    flavor: 'Every page rhymes, including the ones that shouldn\'t.',
  },
  {
    id: 'big_five_partnership', name: 'Big Five Publishers Partnership', kind: 'books', acquisition: 'partnership', domain: 'creative',
    tokensB: 600, quality: 0.9, cost: 30_000_000, annualFee: 25_000_000, legalRisk: 0.05, reputationRisk: 0.05,
    unlockYear: 2024, exclusive: true, contestedBy: ['openaye', 'deepseekers', 'metaverse_llama'], freshnessYear: 2024,
    flavor: 'Five publishers, one signing dinner, and a sales deck that says "moat" eleven times.',
  },
  {
    id: 'nobel_lectures', name: 'Nobel Lectures Archive', kind: 'books', acquisition: 'purchase', domain: 'science',
    tokensB: 0.5, quality: 0.95, cost: 1_000_000, legalRisk: 0.05, unlockYear: 2024,
    flavor: 'Half an hour each, and no speaker has once mentioned the audience.',
  },
  {
    id: 'volunteer_transcription', name: 'Volunteer Transcription Drive', kind: 'books', acquisition: 'crowdsource', domain: 'general',
    tokensB: 2, quality: 0.8, cost: 300_000, legalRisk: 0.05, unlockYear: 2024,
    flavor: 'Retirees transcribing handwritten letters, one exclamation mark at a time.',
  },
  {
    id: 'interlibrary_loan', name: 'Interlibrary Loan, Permanently', kind: 'books', acquisition: 'license', domain: 'science',
    tokensB: 300, quality: 0.85, cost: 10_000_000, annualFee: 9_000_000, legalRisk: 0.1, unlockYear: 2025,
    flavor: 'A library that refuses to return anything. The model is a member in good standing.',
  },
  {
    id: 'forgotten_textbooks', name: 'Anthology of Forgotten Textbooks', kind: 'books', acquisition: 'scrape', domain: 'science',
    tokensB: 40, quality: 0.7, cost: 6_000_000, legalRisk: 0.4, unlockYear: 2026,
    flavor: 'Obsolete in every field, and somehow still right about the ocean.',
  },

  // ======================================================================================
  // CODE
  // ======================================================================================
  {
    id: 'github_firehose', name: 'GitHub Firehose', kind: 'code', acquisition: 'scrape', domain: 'code',
    tokensB: 15, quality: 0.6, cost: 60_000, legalRisk: 0.3, unlockYear: 2017,
    scoreBonus: { coding: 8 }, capBonus: { agentic: 1 },
    flavor: 'Every TODO ever written. Including the ones from 2014.',
  },
  {
    id: 'stackoverflowed', name: 'StackOverflowed', kind: 'code', acquisition: 'purchase', domain: 'code',
    tokensB: 4, quality: 0.8, cost: 40_000, legalRisk: 0.1, unlockYear: 2018,
    scoreBonus: { coding: 5 }, capBonus: { agentic: 0.5 },
    flavor: 'Answers that were marked as duplicates of questions from 2009.',
  },
  {
    id: 'kernel_patches', name: 'Kernel Mailing List Patches', kind: 'code', acquisition: 'open', domain: 'code',
    tokensB: 3, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2019,
    flavor: 'Every patch titled "fix typo" that fixed a typo in a different patch.',
  },
  {
    id: 'stack_underflow', name: 'Stack Underflow (Answers Only)', kind: 'code', acquisition: 'purchase', domain: 'code',
    tokensB: 6, quality: 0.75, cost: 120_000, legalRisk: 0.1, unlockYear: 2019, capBonus: { agentic: 0.5 },
    flavor: 'Every accepted answer, none of the questions. The model is confident about things nobody asked.',
  },
  {
    id: 'jupyter_graveyard', name: 'Jupyter Graveyard', kind: 'code', acquisition: 'scrape', domain: 'science',
    tokensB: 25, quality: 0.45, cost: 300_000, legalRisk: 0.25, unlockYear: 2019, capBonus: { math: 1 },
    flavor: 'Notebooks whose final cell is "import pandas as pd", and then nothing.',
  },
  {
    id: 'minified_js', name: 'Minified JavaScript Forest', kind: 'code', acquisition: 'scrape', domain: 'code',
    tokensB: 60, quality: 0.3, cost: 200_000, legalRisk: 0.2, unlockYear: 2020,
    flavor: 'Every website, minified onto one line, as the gods intended.',
  },
  {
    id: 'package_registry_dump', name: 'Package Registry Dump', kind: 'code', acquisition: 'scrape', domain: 'code',
    tokensB: 120, quality: 0.4, cost: 800_000, legalRisk: 0.3, unlockYear: 2020,
    flavor: 'A dependency tree forty levels deep, at the bottom of which is a package called "left-pad".',
  },
  {
    id: 'oss_license_soup', name: 'Open Source License Soup', kind: 'code', acquisition: 'open', domain: 'legal',
    tokensB: 1, quality: 0.5, cost: 0, legalRisk: 0, unlockYear: 2018,
    flavor: 'Ten thousand LICENSE files, all MIT, several of them lying.',
  },
  {
    id: 'the_stack_mega', name: 'Mega Repo (Totally Licensed)', kind: 'code', acquisition: 'scrape', domain: 'code',
    tokensB: 400, quality: 0.7, cost: 5_000_000, legalRisk: 0.4, unlockYear: 2021,
    scoreBonus: { coding: 6 }, capBonus: { agentic: 1 },
    flavor: 'Every public repo, "licensed" by a README that says MIT.',
  },
  {
    id: 'vuln_db_mirror', name: 'Vulnerability Database Mirror', kind: 'code', acquisition: 'scrape', domain: 'safety',
    tokensB: 2, quality: 0.6, cost: 200_000, legalRisk: 0.35, reputationRisk: 0.3, unlockYear: 2021, capBonus: { safety: 1 },
    flavor: 'Every CVE, most rated "low severity" and one rated "a bit of a problem".',
  },
  {
    id: 'competitive_editorials', name: 'Competitive Programming Editorials (Scraped)', kind: 'code', acquisition: 'scrape', domain: 'math',
    tokensB: 30, quality: 0.7, cost: 500_000, legalRisk: 0.4, unlockYear: 2021, capBonus: { reasoning: 1, math: 1 },
    flavor: 'Editorial solutions that might be the editorial, and might be someone\'s homework.',
  },
  {
    id: 'contract_coders_crowd', name: 'Contract Coders Interview Answers', kind: 'code', acquisition: 'crowdsource', domain: 'code',
    tokensB: 3, quality: 0.8, cost: 900_000, legalRisk: 0.05, unlockYear: 2022,
    flavor: 'Freelance answers to interview questions. Some of them even pass.',
  },
  {
    id: 'cloud_config_archive', name: 'Cloud Config YAML Archive', kind: 'code', acquisition: 'scrape', domain: 'code',
    tokensB: 18, quality: 0.5, cost: 700_000, legalRisk: 0.2, unlockYear: 2022,
    flavor: 'Infrastructure as code. Mostly "port: 8080" and one unexplained "hack: true".',
  },
  {
    id: 'smart_contract_graveyard', name: 'Smart Contract Graveyard', kind: 'code', acquisition: 'scrape', domain: 'finance',
    tokensB: 3, quality: 0.35, cost: 300_000, legalRisk: 0.25, reputationRisk: 0.1, unlockYear: 2022,
    flavor: 'Contracts that promised to make everyone rich. The source is public. The rich part was not.',
  },
  {
    id: 'api_docs_scrape', name: 'API Reference Pages', kind: 'code', acquisition: 'purchase', domain: 'code',
    tokensB: 22, quality: 0.7, cost: 1_500_000, legalRisk: 0.1, unlockYear: 2023, capBonus: { agentic: 1 },
    flavor: 'Every parameter described as "optional". None of them are.',
  },
  {
    id: 'enterprise_monorepo', name: 'Enterprise Monorepo Partnership', kind: 'code', acquisition: 'partnership', domain: 'code',
    tokensB: 800, quality: 0.85, cost: 15_000_000, annualFee: 10_000_000, legalRisk: 0.1, reputationRisk: 0.1,
    unlockYear: 2023, requiresResearch: 'code_models', exclusive: true, contestedBy: ['deepmined', 'openaye'], freshnessYear: 2023,
    flavor: 'Forty thousand internal repos, every one named "final-v2-REAL".',
  },
  {
    id: 'verified_compiler_suite', name: 'Verified Compiler Test Suite', kind: 'code', acquisition: 'purchase', domain: 'code',
    tokensB: 40, quality: 0.88, cost: 6_000_000, legalRisk: 0.05, unlockYear: 2025, requiresResearch: 'code_models',
    capBonus: { agentic: 1, coding: 0.5 },
    flavor: 'Ten thousand programs that either compile or are proven not to. A different kind of honest.',
  },
  {
    id: 'your_api_prompts', name: 'Your API Prompts (Anonymised, Mostly)', kind: 'code', acquisition: 'userdata', domain: 'code',
    tokensB: 80, quality: 0.5, cost: 0, legalRisk: 0.25, reputationRisk: 0.25, unlockYear: 2023, requiresProduct: 'api',
    flavor: 'Developers\' prompts with the secrets removed. Most of them. Some keys were in comments.',
  },
  {
    id: 'lean_proof_corpus', name: 'Lean Proof Corpus', kind: 'code', acquisition: 'purchase', domain: 'math',
    tokensB: 8, quality: 0.82, cost: 2_000_000, legalRisk: 0.05, unlockYear: 2024, capBonus: { math: 3, reasoning: 1 },
    flavor: 'Every proof checked by a compiler, which is more than can be said for most proofs.',
  },

  // ======================================================================================
  // SCIENCE
  // ======================================================================================
  {
    id: 'arxivomit', name: 'ArXivOmit', kind: 'science', acquisition: 'purchase', domain: 'science',
    tokensB: 4, quality: 0.9, cost: 90_000, legalRisk: 0.1, unlockYear: 2018,
    scoreBonus: { reasoning: 3 }, capBonus: { math: 3, knowledge: 1 },
    flavor: 'Preprints, most of them with the word "novel" in the title.',
  },
  {
    id: 'medical_journals', name: 'Paywalled Medical Journals', kind: 'science', acquisition: 'scrape', domain: 'medical',
    tokensB: 10, quality: 0.8, cost: 900_000, legalRisk: 0.75, reputationRisk: 0.2, unlockYear: 2020,
    scoreBonus: { reasoning: 4 }, capBonus: { knowledge: 3 },
    flavor: 'Excellent prose, locked behind four publishers and a login page.',
  },
  {
    id: 'preprint_pile', name: 'Preprint Pile (Unreviewed)', kind: 'science', acquisition: 'scrape', domain: 'science',
    tokensB: 90, quality: 0.5, cost: 1_500_000, legalRisk: 0.15, unlockYear: 2021, scoreBonus: { reasoning: 1 },
    flavor: 'Every preprint since the last preprint. Several have been retracted from the future.',
  },
  {
    id: 'chem_lab_notebooks', name: 'Chemistry Lab Notebooks (Scanned)', kind: 'science', acquisition: 'purchase', domain: 'science',
    tokensB: 2, quality: 0.7, cost: 200_000, legalRisk: 0.05, unlockYear: 2019, capBonus: { knowledge: 1 },
    flavor: 'Handwritten, coffee-stained, and somehow still flammable in the training data.',
  },
  {
    id: 'climate_model_outputs', name: 'Climate Model Outputs', kind: 'science', acquisition: 'open', domain: 'science',
    tokensB: 12, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2021,
    flavor: 'Every climate projection ever published. Most are history now. Some of them were right.',
  },
  {
    id: 'telescope_logs', name: 'Telescope Observation Logs', kind: 'science', acquisition: 'open', domain: 'science',
    tokensB: 4, quality: 0.55, cost: 0, legalRisk: 0, unlockYear: 2019,
    flavor: 'Clear skies, cloudy nights, and one "probably a satellite" every single night.',
  },
  {
    id: 'protein_atlas', name: 'Protein Structure Atlas', kind: 'science', acquisition: 'license', domain: 'science',
    tokensB: 6, quality: 0.9, cost: 2_000_000, annualFee: 1_200_000, legalRisk: 0.05, unlockYear: 2020, capBonus: { knowledge: 2 },
    flavor: 'Every folded protein the lab has ever photographed. A lot of origami.',
  },
  {
    id: 'clinical_trials_registry', name: 'Clinical Trial Registry (Redacted-ish)', kind: 'science', acquisition: 'license', domain: 'medical',
    tokensB: 5, quality: 0.85, cost: 500_000, annualFee: 400_000, legalRisk: 0.2, reputationRisk: 0.15, unlockYear: 2022,
    capBonus: { knowledge: 2 },
    flavor: 'Results that were published, plus a few "still being analysed" for six years.',
  },
  {
    id: 'math_olympiad_archive', name: 'Math Olympiad Solutions Archive', kind: 'science', acquisition: 'purchase', domain: 'math',
    tokensB: 1, quality: 0.85, cost: 400_000, legalRisk: 0.05, unlockYear: 2021, capBonus: { math: 2.5 },
    flavor: 'Elegant solutions, written by people who would rather be asleep.',
  },
  {
    id: 'seismic_waveforms', name: 'Seismic Waveforms (Open Archive)', kind: 'science', acquisition: 'open', domain: 'science',
    tokensB: 3, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2021,
    flavor: 'The Earth, shaking politely. Labelled "noise" at the top of every file.',
  },
  {
    id: 'lab_protocols_drive', name: 'Lab Protocols (Shared Drive Edition)', kind: 'science', acquisition: 'purchase', domain: 'science',
    tokensB: 3, quality: 0.75, cost: 2_000_000, legalRisk: 0.1, unlockYear: 2023,
    flavor: 'Step 4 says "add a little more" with no unit. The model now also says this.',
  },
  {
    id: 'astrophysics_sims', name: 'Astrophysics Simulation Archive', kind: 'science', acquisition: 'purchase', domain: 'science',
    tokensB: 60, quality: 0.8, cost: 6_000_000, legalRisk: 0.05, unlockYear: 2024, capBonus: { math: 1 },
    flavor: 'Galaxies collided in silico ten million times. None of them invited us.',
  },
  {
    id: 'materials_database_merger', name: 'Materials Database Merger', kind: 'science', acquisition: 'license', domain: 'science',
    tokensB: 150, quality: 0.85, cost: 8_000_000, annualFee: 6_000_000, legalRisk: 0.08, unlockYear: 2025, capBonus: { knowledge: 2 },
    flavor: 'Every alloy with a nickname. The database has more names than the periodic table has elements.',
  },
  {
    id: 'quantum_chem_outputs', name: 'Quantum Chemistry Outputs', kind: 'science', acquisition: 'purchase', domain: 'science',
    tokensB: 900, quality: 0.8, cost: 25_000_000, legalRisk: 0.05, unlockYear: 2026, capBonus: { knowledge: 2, math: 1 },
    flavor: 'Wavefunctions for molecules nobody can name, including one named after a cat.',
  },
  {
    id: 'fusion_telemetry', name: 'Fusion Reactor Telemetry (Restricted)', kind: 'science', acquisition: 'scrape', domain: 'science',
    tokensB: 500, quality: 0.85, cost: 400_000_000, legalRisk: 0.8, reputationRisk: 0.6, unlockYear: 2029, freshnessYear: 2029,
    capBonus: { knowledge: 3, math: 2 },
    flavor: 'Plasma readings from a reactor that is "not operational" and runs at fourteen gigawatts.',
  },
  {
    id: 'decontam_reasoning', name: 'Decontaminated Reasoning Set (Verified)', kind: 'science', acquisition: 'purchase', domain: 'math',
    tokensB: 15, quality: 0.85, cost: 4_000_000, legalRisk: 0.05, unlockYear: 2025, requiresResearch: 'decontamination',
    capBonus: { reasoning: 2, math: 2 },
    flavor: 'Problems verified to appear nowhere on the internet. Including, for some reason, here.',
  },

  // ======================================================================================
  // DIALOGUE
  // ======================================================================================
  {
    id: 'reddit_dump', name: 'Reddit Dump', kind: 'dialogue', acquisition: 'scrape', domain: 'dialogue',
    tokensB: 25, quality: 0.4, cost: 80_000, legalRisk: 0.35, unlockYear: 2017,
    scoreBonus: { chat: 4 }, capBonus: { multilingual: 1 },
    flavor: 'Opinions, unfiltered. The model learns to be confidently wrong.',
  },
  {
    id: 'customer_support_public', name: 'Public Support Ticket Sample', kind: 'dialogue', acquisition: 'open', domain: 'general',
    tokensB: 2, quality: 0.5, cost: 0, legalRisk: 0, unlockYear: 2018,
    flavor: '"Please restart your router." Ticket closed. Ticket reopened. Ticket closed.',
  },
  {
    id: 'forum_arguments', name: 'Forum Arguments, Archived', kind: 'dialogue', acquisition: 'scrape', domain: 'dialogue',
    tokensB: 20, quality: 0.35, cost: 100_000, legalRisk: 0.25, reputationRisk: 0.1, unlockYear: 2018,
    flavor: 'Two people, one thread, forty pages. Somehow both are right at the end.',
  },
  {
    id: 'movie_subtitles', name: 'Movie Subtitles (Allegedly Licensed)', kind: 'dialogue', acquisition: 'scrape', domain: 'creative',
    tokensB: 35, quality: 0.6, cost: 700_000, legalRisk: 0.55, unlockYear: 2019,
    flavor: '[MUSIC PLAYING] Every film, one subtitle file at a time.',
  },
  {
    id: 'ted_monologues', name: 'Keynote Monologues (TED-ish)', kind: 'dialogue', acquisition: 'purchase', domain: 'creative',
    tokensB: 1.5, quality: 0.7, cost: 80_000, legalRisk: 0.05, unlockYear: 2019,
    flavor: 'Ninety-minute ideas delivered in eighteen. Every one begins with a story about a teacher.',
  },
  {
    id: 'call_centre_licence', name: 'Call Centre Transcript Licence', kind: 'dialogue', acquisition: 'license', domain: 'general',
    tokensB: 15, quality: 0.7, cost: 300_000, annualFee: 250_000, legalRisk: 0.2, unlockYear: 2020,
    flavor: 'Hold music excluded. Customer frustration, preserved in full.',
  },
  {
    id: 'youtube_subtitles', name: 'YouTube Subtitles (Allegedly)', kind: 'dialogue', acquisition: 'scrape', domain: 'video',
    tokensB: 120, quality: 0.55, cost: 2_500_000, legalRisk: 0.7, reputationRisk: 0.2, unlockYear: 2020,
    flavor: 'Auto-captions of ten million videos, several hundred of which are someone\'s cat.',
  },
  {
    id: 'wsb_dumpsters', name: 'WallStreetBetter Dumpster', kind: 'dialogue', acquisition: 'scrape', domain: 'finance',
    tokensB: 8, quality: 0.3, cost: 50_000, legalRisk: 0.2, unlockYear: 2021,
    scoreBonus: { chat: 2 },
    flavor: 'Financial advice from people who are definitely not financial advisors.',
  },
  {
    id: 'human_preferences', name: 'Human Preference Pairs', kind: 'dialogue', acquisition: 'crowdsource', domain: 'dialogue',
    tokensB: 0.5, quality: 0.9, cost: 400_000, legalRisk: 0.15, unlockYear: 2021, requiresResearch: 'rlhf',
    scoreBonus: { chat: 5, safety: 3 },
    flavor: 'Two answers, one thumb. Contractors in three time zones.',
  },
  {
    id: 'speedrun_commentary', name: 'Speedrun Commentary', kind: 'dialogue', acquisition: 'purchase', domain: 'gaming',
    tokensB: 3, quality: 0.6, cost: 150_000, legalRisk: 0.1, unlockYear: 2021, capBonus: { reasoning: 0.5, chat: 1 },
    flavor: 'Ninety-minute voiceover of a four-minute run. Everyone\'s favourite part is the glitch.',
  },
  {
    id: 'improv_transcripts', name: 'Improv Comedy Transcripts', kind: 'dialogue', acquisition: 'purchase', domain: 'creative',
    tokensB: 2, quality: 0.6, cost: 200_000, legalRisk: 0.1, unlockYear: 2020, scoreBonus: { chat: 1 },
    flavor: 'Yes, and... and that is the entire model.',
  },
  {
    id: 'press_scrums', name: 'Press Scrum Transcripts', kind: 'dialogue', acquisition: 'scrape', domain: 'news',
    tokensB: 3, quality: 0.4, cost: 300_000, legalRisk: 0.3, reputationRisk: 0.35, unlockYear: 2022,
    flavor: '"I refer you to my earlier answer", in forty languages.',
  },
  {
    id: 'chatbot_arena_votes', name: 'Chatbot Arena Votes', kind: 'dialogue', acquisition: 'open', domain: 'dialogue',
    tokensB: 5, quality: 0.6, cost: 0, legalRisk: 0, unlockYear: 2023,
    flavor: 'Strangers picking the less wrong of two chatbots. Most votes say "both are wrong".',
  },
  {
    id: 'dungeon_master_logs', name: 'Dungeon Master Logs', kind: 'dialogue', acquisition: 'open', domain: 'gaming',
    tokensB: 4, quality: 0.55, cost: 0, legalRisk: 0, unlockYear: 2024,
    flavor: 'Three-hour campaigns in which the party has been "rolling for initiative" since 2019.',
  },
  {
    id: 'dating_chat_logs', name: 'Dating App Message Logs (Anonymised, Allegedly)', kind: 'dialogue', acquisition: 'scrape', domain: 'general',
    tokensB: 25, quality: 0.45, cost: 900_000, legalRisk: 0.8, reputationRisk: 0.5, unlockYear: 2022,
    flavor: 'Everything "hey" turned into. The anonymisation is a first name and a sad emoji.',
  },
  {
    id: 'crisis_line_transcripts', name: 'Crisis Line Transcripts (Consented, Mostly)', kind: 'dialogue', acquisition: 'purchase', domain: 'safety',
    tokensB: 1, quality: 0.85, cost: 1_500_000, legalRisk: 0.4, reputationRisk: 0.3, unlockYear: 2024, capBonus: { safety: 2 },
    flavor: 'Hard conversations, handled well, under a data-sharing agreement nobody can quite find.',
  },
  {
    id: 'enterprise_slack_export', name: 'Enterprise Slack Export Partnership', kind: 'dialogue', acquisition: 'partnership', domain: 'general',
    tokensB: 300, quality: 0.6, cost: 10_000_000, annualFee: 6_000_000, legalRisk: 0.5, reputationRisk: 0.5,
    unlockYear: 2024, requiresProduct: 'enterprise', exclusive: true, contestedBy: ['openaye', 'mistrial'],
    flavor: 'Every "quick sync" ever held, and at least one "can you hop on a call".',
  },
  {
    id: 'reddit_api_deal', name: 'Reddit API Deal', kind: 'dialogue', acquisition: 'partnership', domain: 'general',
    tokensB: 400, quality: 0.55, cost: 30_000_000, annualFee: 20_000_000, legalRisk: 0.1, reputationRisk: 0.2,
    unlockYear: 2023, exclusive: true, contestedBy: ['openaye', 'metaverse_llama'], freshnessYear: 2023,
    flavor: 'Thirty years of opinions, now with an API key and a standing invoice.',
  },
  {
    id: 'telemetry_exhaust', name: 'Telemetry Exhaust (Opt-Out Edition)', kind: 'dialogue', acquisition: 'userdata', domain: 'general',
    tokensB: 30, quality: 0.5, cost: 0, legalRisk: 0.2, reputationRisk: 0.35, unlockYear: 2022, requiresProduct: 'chat',
    flavor: 'Every chat, minus the ones users asked us to skip. The skip list is also in the dataset.',
  },
  {
    id: 'your_support_tickets', name: 'Your Enterprise Support Tickets', kind: 'dialogue', acquisition: 'userdata', domain: 'general',
    tokensB: 40, quality: 0.6, cost: 0, legalRisk: 0.35, reputationRisk: 0.3, unlockYear: 2024, requiresProduct: 'enterprise',
    flavor: 'Support tickets from your enterprise customers, who were told this would never happen.',
  },
  {
    id: 'dead_forum_backup', name: 'Dead Forum Backup', kind: 'dialogue', acquisition: 'scrape', domain: 'gaming',
    tokensB: 40, quality: 0.5, cost: 300_000, legalRisk: 0.6, reputationRisk: 0.4, unlockYear: 2022, secret: true,
    flavor: 'A forum that closed in 2014, archived by its former moderator, who also wants a word about it.',
  },
  {
    id: 'rival_chat_leak', name: 'Rival Lab Chat Logs (Leaked)', kind: 'dialogue', acquisition: 'scrape', domain: 'general',
    tokensB: 500, quality: 0.8, cost: 25_000_000, legalRisk: 0.9, reputationRisk: 0.9, unlockYear: 2029, freshnessYear: 2029, secret: true,
    flavor: 'Internal chats from a rival lab. Mostly a lunch order, and a very angry email about the lunch order.',
  },

  // ======================================================================================
  // SYNTHETIC (static vendor corpora; player-made ones come from generateSynthetic)
  // ======================================================================================
  {
    id: 'textbooks_synth', name: 'Textbooks Are All You Need-ish', kind: 'synthetic', acquisition: 'generate', domain: 'science',
    tokensB: 50, quality: 0.92, cost: 3_000_000, legalRisk: 0.05, unlockYear: 2024, requiresResearch: 'synthetic_data',
    scoreBonus: { reasoning: 5 }, capBonus: { math: 3, knowledge: 2 },
    flavor: 'A model wrote textbooks for another model. The textbooks are great.',
  },
  {
    id: 'self_play_chats', name: 'Self-Play Chatter', kind: 'synthetic', acquisition: 'generate', domain: 'dialogue',
    tokensB: 500, quality: 0.7, cost: 10_000_000, legalRisk: 0.1, unlockYear: 2025, requiresResearch: 'synthetic_data',
    scoreBonus: { chat: 4 },
    flavor: 'Two chatbots talk until they agree. Then they talk about why.',
  },
  {
    id: 'vendor_textbook_mill', name: 'Vendor Textbook Mill', kind: 'synthetic', acquisition: 'generate', domain: 'science',
    tokensB: 800, quality: 0.75, cost: 8_000_000, legalRisk: 0.05, unlockYear: 2025, requiresResearch: 'synthetic_data',
    requiresModelOverall: 55, capBonus: { knowledge: 2 },
    flavor: 'Textbooks written by a model, for a model, with a chapter about the model.',
  },
  {
    id: 'cot_scratchpads', name: 'Chain-of-Thought Scratchpads (Synthetic)', kind: 'synthetic', acquisition: 'generate', domain: 'math',
    tokensB: 120, quality: 0.7, cost: 6_000_000, legalRisk: 0.05, unlockYear: 2025, requiresResearch: 'chain_of_thought',
    capBonus: { reasoning: 2 },
    flavor: 'Step one: think. Step two: think harder. Step three: the answer is "it depends".',
  },
  {
    id: 'debate_club_bots', name: 'Debate Club (Bot vs Bot)', kind: 'synthetic', acquisition: 'generate', domain: 'dialogue',
    tokensB: 200, quality: 0.65, cost: 4_000_000, legalRisk: 0.1, unlockYear: 2025, requiresResearch: 'synthetic_data',
    capBonus: { reasoning: 1 },
    flavor: 'Two chatbots argue until someone concedes. Neither has ever conceded.',
  },
  {
    id: 'distilled_dreams', name: 'Distilled Dreams', kind: 'synthetic', acquisition: 'generate', domain: 'general',
    tokensB: 2000, quality: 0.7, cost: 20_000_000, legalRisk: 0.05, unlockYear: 2026, requiresResearch: 'distillation',
    requiresModelOverall: 65,
    flavor: 'A large model\'s habits, poured into a small one. Also its favourite phrases.',
  },
  {
    id: 'proof_rejections', name: 'Rejection-Sampled Proofs', kind: 'synthetic', acquisition: 'generate', domain: 'math',
    tokensB: 30, quality: 0.85, cost: 5_000_000, legalRisk: 0.02, unlockYear: 2026, requiresResearch: 'synthetic_data',
    requiresModelOverall: 70, capBonus: { math: 3 },
    flavor: 'Only the proofs that passed the checker. Thousands of pages nobody reads, all correct.',
  },
  {
    id: 'in_house_reviews', name: 'In-House Product Reviews', kind: 'synthetic', acquisition: 'generate', domain: 'creative',
    tokensB: 90, quality: 0.5, cost: 3_000_000, legalRisk: 0.4, reputationRisk: 0.5, unlockYear: 2026, requiresResearch: 'synthetic_data',
    flavor: 'Five stars, every time, from people who have never owned the product. Very honest.',
  },
  {
    id: 'agent_trajectories', name: 'Agent Trajectories (Sanitised)', kind: 'synthetic', acquisition: 'generate', domain: 'general',
    tokensB: 150, quality: 0.7, cost: 12_000_000, legalRisk: 0.1, unlockYear: 2026, requiresResearch: 'agents',
    flavor: 'Computers clicking through websites, then narrating it. Several of the narrations are accurate.',
  },
  {
    id: 'self_critique_constitution', name: 'Self-Critique Constitution Set', kind: 'synthetic', acquisition: 'generate', domain: 'safety',
    tokensB: 60, quality: 0.8, cost: 9_000_000, legalRisk: 0.05, unlockYear: 2026, requiresResearch: 'constitutional_ai',
    requiresModelOverall: 60, capBonus: { safety: 3 },
    flavor: 'The model criticised its answers, then criticised the critique. Thirty-two drafts per question.',
  },
  {
    id: 'synthetic_briefs', name: 'Hallucination-Checked Legal Briefs', kind: 'synthetic', acquisition: 'generate', domain: 'legal',
    tokensB: 40, quality: 0.7, cost: 12_000_000, legalRisk: 0.3, reputationRisk: 0.2, unlockYear: 2027, requiresResearch: 'synthetic_data',
    requiresModelOverall: 70,
    flavor: 'Every citation verified, by a model that also invented it. Mostly verified.',
  },
  {
    id: 'curriculum_problems', name: 'Auto-Curriculum Problem Set', kind: 'synthetic', acquisition: 'generate', domain: 'math',
    tokensB: 300, quality: 0.8, cost: 40_000_000, legalRisk: 0.05, unlockYear: 2027, requiresResearch: 'self_improvement',
    requiresModelOverall: 80,
    flavor: 'Problems that get harder whenever you get better at them. Retirement is not an option.',
  },
  {
    id: 'model_written_evals', name: 'Model-Written Safety Evals', kind: 'synthetic', acquisition: 'generate', domain: 'safety',
    tokensB: 10, quality: 0.6, cost: 15_000_000, legalRisk: 0.05, unlockYear: 2028, requiresResearch: 'interpretability',
    capBonus: { safety: 2 },
    flavor: 'Exams written by the students, graded by the students, then graded again by the students\' teacher.',
  },
  {
    id: 'frontier_self_distill', name: 'Frontier Self-Distillation Swarm', kind: 'synthetic', acquisition: 'generate', domain: 'general',
    tokensB: 25_000, quality: 0.85, cost: 500_000_000, legalRisk: 0.05, unlockYear: 2030, requiresResearch: 'self_improvement',
    requiresModelOverall: 85,
    flavor: 'A model teaching its successor, which teaches its successor, which asks for a raise.',
  },
  {
    id: 'infinite_textbook_factory', name: 'Infinite Textbook Factory', kind: 'synthetic', acquisition: 'generate', domain: 'science',
    tokensB: 80_000, quality: 0.88, cost: 1_500_000_000, legalRisk: 0.05, unlockYear: 2031, requiresResearch: 'world_models',
    requiresModelOverall: 90,
    flavor: 'Every subject, every grade level, and chapter eleven, which is about the moon.',
  },

  // ======================================================================================
  // MULTIMODAL
  // ======================================================================================
  {
    id: 'pixel_pile', name: 'Pixel Pile (Captioned)', kind: 'multimodal', acquisition: 'scrape', domain: 'vision',
    tokensB: 40, quality: 0.55, cost: 3_000_000, legalRisk: 0.7, unlockYear: 2022, requiresResearch: 'multimodal',
    scoreBonus: { chat: 3 }, capBonus: { vision: 30 },
    flavor: 'Images with captions written by a different model. Recursion is fun.',
  },
  {
    id: 'every_podcast', name: 'Every Podcast Ever', kind: 'multimodal', acquisition: 'scrape', domain: 'audio',
    tokensB: 300, quality: 0.5, cost: 15_000_000, legalRisk: 0.65, unlockYear: 2025, requiresResearch: 'multimodal',
    scoreBonus: { chat: 3, reasoning: 1 }, capBonus: { vision: 8 },
    flavor: 'Audio, transcribed, and about 40% sponsor reads.',
  },
  {
    id: 'stock_photo_licence', name: 'Stock Photo Mega Licence', kind: 'multimodal', acquisition: 'license', domain: 'vision',
    tokensB: 40, quality: 0.75, cost: 2_000_000, annualFee: 1_000_000, legalRisk: 0.1, unlockYear: 2020, requiresResearch: 'multimodal',
    capBonus: { vision: 6 },
    flavor: 'Four hundred million photos of a person laughing at a salad.',
  },
  {
    id: 'dashcam_archive', name: 'Dashcam Footage (Blurred, Mostly)', kind: 'multimodal', acquisition: 'purchase', domain: 'video',
    tokensB: 80, quality: 0.5, cost: 5_000_000, legalRisk: 0.4, unlockYear: 2023, requiresResearch: 'multimodal',
    capBonus: { vision: 6 },
    flavor: 'Every road, every near-miss, and a man shouting at a pigeon in the left lane.',
  },
  {
    id: 'cooking_video_corpus', name: 'Cooking Show Video Corpus', kind: 'multimodal', acquisition: 'scrape', domain: 'video',
    tokensB: 60, quality: 0.5, cost: 2_000_000, legalRisk: 0.55, unlockYear: 2022, requiresResearch: 'multimodal',
    capBonus: { vision: 5 },
    flavor: 'Ninety-second recipe montages in which the actual cooking happens off-screen.',
  },
  {
    id: 'museum_scans_pd', name: 'Museum Scans (Public Domain Edition)', kind: 'multimodal', acquisition: 'open', domain: 'vision',
    tokensB: 8, quality: 0.55, cost: 0, legalRisk: 0, unlockYear: 2019,
    capBonus: { vision: 4 },
    flavor: 'Ten thousand paintings of the same three saints, photographed under inadequate lighting.',
  },
  {
    id: 'satellite_tiles', name: 'Satellite Tiles, Refreshed', kind: 'multimodal', acquisition: 'license', domain: 'science',
    tokensB: 200, quality: 0.8, cost: 6_000_000, annualFee: 4_000_000, legalRisk: 0.1, unlockYear: 2024, requiresResearch: 'multimodal',
    capBonus: { vision: 8 }, freshnessYear: 2024,
    flavor: 'Every field in the world, updated weekly, and about 40% of them are cloud.',
  },
  {
    id: 'hospital_imaging_partnership', name: 'Hospital Imaging Ward Partnership', kind: 'multimodal', acquisition: 'partnership', domain: 'medical',
    tokensB: 40, quality: 0.9, cost: 25_000_000, annualFee: 15_000_000, legalRisk: 0.2, reputationRisk: 0.3, unlockYear: 2025,
    requiresResearch: 'multimodal', exclusive: true, contestedBy: ['deepmined'], capBonus: { vision: 8 },
    flavor: 'Scans from twelve hospitals, anonymised, and a press release that says "curated" eleven times.',
  },
  {
    id: 'sign_language_corpus', name: 'Sign Language Video Corpus', kind: 'multimodal', acquisition: 'crowdsource', domain: 'video',
    tokensB: 6, quality: 0.8, cost: 800_000, legalRisk: 0.1, unlockYear: 2023, requiresResearch: 'multimodal',
    capBonus: { vision: 4 },
    flavor: 'Volunteers signing everything from weather reports to very dramatic poetry.',
  },
  {
    id: 'robot_arm_trajectories', name: 'Robot Arm Trajectories (Lab Grade)', kind: 'multimodal', acquisition: 'purchase', domain: 'robotics',
    tokensB: 12, quality: 0.75, cost: 12_000_000, legalRisk: 0.05, unlockYear: 2026, requiresResearch: 'world_models',
    capBonus: { agentic: 2, vision: 3 },
    flavor: 'Ten thousand attempts to pick up a mug. Ninety percent end with the mug on the floor, which is the training signal.',
  },
  {
    id: 'live_stream_archive', name: 'Live Stream Archive (All of It)', kind: 'multimodal', acquisition: 'scrape', domain: 'gaming',
    tokensB: 500, quality: 0.4, cost: 30_000_000, legalRisk: 0.7, reputationRisk: 0.3, unlockYear: 2025, requiresResearch: 'multimodal',
    capBonus: { vision: 6 },
    flavor: 'Eleven thousand hours of someone building a house in a game about building houses.',
  },
  {
    id: 'robot_read_audiobooks', name: 'Audiobook Narration, Robot-Read', kind: 'multimodal', acquisition: 'purchase', domain: 'audio',
    tokensB: 90, quality: 0.6, cost: 3_000_000, legalRisk: 0.25, unlockYear: 2026, requiresResearch: 'multimodal',
    scoreBonus: { chat: 1 },
    flavor: 'Synthetic narration of real books. A legal grey zone with a very nice voice.',
  },
  {
    id: 'film_frames_licence', name: 'Film Frames (Four Studios)', kind: 'multimodal', acquisition: 'license', domain: 'video',
    tokensB: 90, quality: 0.8, cost: 8_000_000, annualFee: 5_000_000, legalRisk: 0.15, unlockYear: 2024, requiresResearch: 'multimodal',
    capBonus: { vision: 7 },
    flavor: 'Every frame in four studios\' catalogues, with the rights holders on speed-dial.',
  },
  {
    id: 'movie_trailers_scrape', name: 'Movie Trailers, All Dramatic', kind: 'multimodal', acquisition: 'scrape', domain: 'video',
    tokensB: 20, quality: 0.5, cost: 1_500_000, legalRisk: 0.5, unlockYear: 2023, requiresResearch: 'multimodal',
    capBonus: { vision: 5 },
    flavor: 'Ninety seconds of explosions, each followed by a slow-motion man walking away from them.',
  },
  {
    id: 'lidar_drive_logs', name: 'Lidar Drive Logs', kind: 'multimodal', acquisition: 'license', domain: 'robotics',
    tokensB: 400, quality: 0.8, cost: 40_000_000, annualFee: 20_000_000, legalRisk: 0.15, unlockYear: 2028, requiresResearch: 'world_models',
    capBonus: { vision: 6, agentic: 1 },
    flavor: 'Point clouds of everything that was briefly in front of a car.',
  },
  {
    id: 'autonomous_sensor_partnership', name: 'Autonomous Car Sensor Partnership', kind: 'multimodal', acquisition: 'partnership', domain: 'robotics',
    tokensB: 2000, quality: 0.85, cost: 300_000_000, annualFee: 150_000_000, legalRisk: 0.2, reputationRisk: 0.1, unlockYear: 2029,
    requiresResearch: 'world_models', exclusive: true, contestedBy: ['metaverse_llama', 'deepseekers'], capBonus: { vision: 8, agentic: 1 },
    flavor: 'Two million road-hours of sensor data, licensed by a company that is also a car company, a phone company and a weather app.',
  },

  // ======================================================================================
  // MEGA DEALS (late game, very large)
  // ======================================================================================
  {
    id: 'licensed_everything', name: 'Licensed Everything Deal', kind: 'web', acquisition: 'license', domain: 'general',
    tokensB: 50_000, quality: 0.8, cost: 500_000_000, annualFee: 1_500_000_000, legalRisk: 0.15, unlockYear: 2027,
    freshnessYear: 2027, capBonus: { knowledge: 2, multilingual: 2 },
    flavor: 'Fifty trillion tokens, one signing ceremony, and a lawyer who never sleeps.',
  },
];
