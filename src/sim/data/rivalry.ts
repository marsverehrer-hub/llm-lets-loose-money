// OWNER: COMP agent. Rival trash talk and reaction headlines (GAME_DESIGN.md §18.1). Parody labs and parody voices only.
// Placeholders: {lab} rival name, {model} model name, {company} the player's company, {n} a head count, {bench} a benchmark name.
import type { Personality } from '../types';

/** Rivalry tiers: index = how many of these thresholds the rivalry has reached (see competitors.ts RIVALRY_TIERS). */
export const RIVALRY_TIER_COUNT = 4;

/** CEO quotes by lab id, then rivalry tier 0..3 (low to high). Each tier has at least four lines. */
export const CEO_QUOTES: Record<string, readonly (readonly string[])[]> = {
  deepmined: [
    [
      'We read your model card. It was adequate.',
      'Our next paper will cite yours in a footnote. We consider that a compliment.',
      'Interesting result. We reproduced the idea in 2014, with more citations.',
      'We are not worried. We are curious, which is different and more expensive.',
    ],
    [
      'Your benchmarks are fine. Your methodology section is a crime scene.',
      'A reviewer has asked to speak with you about your evaluation set.',
      'The arena is a noisy proxy for understanding. We are watching the arena anyway.',
      'A respectable result. We have assigned a team to be mildly annoyed by it.',
    ],
    [
      'We have convened a committee. The committee has a slide deck, and the deck is long.',
      'Our researchers have stopped publishing and started glaring.',
      'You are now a citation we have to take seriously. We resent that.',
      'We will beat your score with a method nobody can explain. That is how we do things.',
    ],
    [
      'This is a personal matter for the lab now. Several postdocs have cried.',
      'We rebuilt the pretraining stack around one number, and the number is yours.',
      'The board asked why we are not number one. We have a 60-page answer and no date.',
      'Expect a paper. It will have a title that starts with "Overcoming".',
    ],
  ],
  openaye: [
    [
      'We are not competing. We are the future, running a little late.',
      'Every model we ship is a step toward something enormous. Mostly the valuation.',
      'Your launch was cute. Ours will be a moment in history, approximately Tuesday.',
      'We love competition. It proves the category exists, which our investors love.',
    ],
    [
      'A rival shipped something. Our community calls it a warning shot. We call it a warm-up.',
      'We noticed your leaderboard, very loudly, on a stage.',
      'You are on our radar. The radar is a keynote slide, and the keynote is in October.',
      'We are excited for you. We are also very excited for us, obviously.',
    ],
    [
      'This is war, but a friendly one, with a launch event and a sponsor.',
      'We have hired a second hype team. The first one is still hyping.',
      'Our next model will make everyone feel something. Investors, mostly.',
      'They called us a hype machine. We have printed the phrase on the lobby wall.',
    ],
    [
      'We will not name you. We will simply call our next model the one that ends this.',
      'Our CEO has been seen at a whiteboard, drawing a circle around your company name.',
      'Every rival eventually becomes a case study. You are on track to be one.',
      'Tomorrow we ship something unprecedented. Today we are informing the press that you exist.',
    ],
  ],
  anthropomorphic: [
    [
      'We have concerns about the model. We also have concerns about our concerns.',
      'Our new model is safe. We wrote 200 pages to convince ourselves of that.',
      'We wish you well, and we are worried about you, in a supportive way.',
      'Please use our model responsibly. Please use yours responsibly too. Please.',
    ],
    [
      'We have added a feelings section to our model card. It is very long.',
      'Competition is healthy. Unregulated competition is a letter we are drafting.',
      'We are not trying to win. We are trying to be the careful one about winning.',
      'Your model is a little too capable for our taste, and we are sad about that.',
    ],
    [
      'We are concerned that you are winning. We are also concerned about our margins.',
      'We are going to publish an essay on why your launch was premature.',
      'Our model is cautious about everything, including you. That is the brand.',
      'We asked a panel to reflect on the arena. The panel asked for a bigger budget.',
    ],
    [
      'We have a plan. The plan is worry, scheduled in quarterly increments.',
      'We do not want a race. We do want to be ahead of the race, responsibly.',
      'We believe you are a risk. We also believe we are the only ones who can say so.',
      'Our researchers are calm. Our communications team is not calm at all.',
    ],
  ],
  metaverse_llama: [
    [
      'Free weights for everyone. Terms of service sold separately.',
      'Open is the future. Your closed model is a gift we are politely declining.',
      'We put it on the internet, so now it is yours too. Please do not read the license.',
      'Our model runs on a laptop. Yours runs on a conscience and a credit card.',
    ],
    [
      'You have a closed model. We have a community, which is bigger and more annoying.',
      'A thousand fine-tunes are coming, and each one is a small rude letter to you.',
      'Your pricing is nice. Our pricing is a download link.',
      'We want the weights in every hand. Yours are in a vault, which is a sad place for weights.',
    ],
    [
      'This is a movement now. Movements do not respect enterprise sales cycles.',
      'We will out-open you. We have opened the wiki, the chat server and the group thread.',
      'Our community has started a fan-fiction account about your CEO. It is unkind.',
      'Your moat is a fence. We are building a bridge, and then giving the bridge away.',
    ],
    [
      'We are coming for your revenue, one free download at a time.',
      'We keep a leaderboard of forks. You are in the bottom half of it, in spirit.',
      'Our models are everywhere. You are somewhere, mostly in a press release.',
      'Let them pay for the API. We will offer the sunlight, which is free.',
    ],
  ],
  mistrial: [
    [
      'Cheaper. Faster. Adequate.',
      'We do not chase. We undercut, then we stroll.',
      'Our model is smaller. Our invoice is smaller. Our mood is unchanged.',
      'Good engineering. Bad marketing. We prefer it that way.',
    ],
    [
      'You are expensive. We have noticed. We have also noticed you are slow.',
      'We will match your price. We will not match your slide deck.',
      'Pricing is a conversation. We have finished the conversation.',
      'Your product is nice. Ours is nicer per euro, and the euro is ours.',
    ],
    [
      'We are in a price war now. The war is in Paris. We are not leaving Paris.',
      'We have cut again. We will cut once more, and then we will have lunch.',
      'We build for less. You build for a keynote. Both are valid, but one is cheaper.',
      'Your margins are a target. Our margins are a rounding error, deliberately.',
    ],
    [
      'The war is total. We have sent a single word: discount.',
      'We do not hate you. We simply cost less, and we will keep costing less.',
      'We have no fear. We have a spreadsheet, and your name is at the top of it.',
      'Stop paying more. We will wait, quietly, at a lower price.',
    ],
  ],
  deepseekers: [
    [
      'We shipped. The rest of the sentence is in the weights.',
      'Efficient is a word we use when nobody is watching.',
      'Our costs are low. Our tone is lower.',
      'We do not comment on competitors. We comment on training runs.',
    ],
    [
      'Your model is good. We made ours good for less. That is all.',
      'We read the arena every morning. We say nothing, and then we ship.',
      'Your compute bill is a story. Ours is a footnote.',
      'We are not in a race. We are in a queue, and we are near the front.',
    ],
    [
      'We are close. Close is enough when your price is wrong for the customer.',
      'Your board is having feelings. We are not, on purpose.',
      'We will release on a holiday again. Nobody will be ready, which is the plan.',
      'The frontier is a place we visit. We are staying a while.',
    ],
    [
      'We have one goal, and it is on the leaderboard, and it is yours to lose.',
      'We do not want a fight. We already won the cost argument.',
      'The next model will be quiet. It will also be very, very good.',
      'We counted your tokens. The number is smaller than yours.',
    ],
  ],
  // v16 labs
  alibabble: [
    [
      'We released three models while you read this sentence.',
      'Your model is good. Which of our forty is it closest to?',
      'We are an e-commerce company. Models are just another thing in the basket.',
      'Open weights are our love language. Also our marketing budget.',
    ],
    [
      'We saw your launch. We have fine-tuned on the announcement.',
      'Your price is interesting. Ours is a rounding error with a logo.',
      'Every developer downloads us. Some of them even know they did.',
      'The leaderboard has a scroll bar now. We are most of it.',
    ],
    [
      'We have assigned a team to you. The team ships weekly.',
      'Your moat is a puddle. We brought a pump and a coder model.',
      'We will release a version of your model for free, slightly better, by Friday.',
      'Shopping season is over. Release season is permanent.',
    ],
    [
      'Every size, every license, every week. Your move.',
      'We have stopped counting releases. The counter overflowed.',
      'Your enterprise customers have our weights on a thumb drive already.',
      'We do not sleep. We quantize.',
    ],
  ],
  moonshoot: [
    [
      'We read your paper. All of it. In one context window.',
      'Long context is not a feature. It is a lifestyle.',
      'We are a small team with a large moon and a larger cluster bill.',
      'Your model forgets the beginning of the conversation. Ours remembers your birthday.',
    ],
    [
      'Your context window is a postcard. Ours is a library.',
      'Our agents ran for three hours and filed the paperwork for you.',
      'We named the company after a moonshot. The moon is getting nervous.',
      'Your benchmark scores fit in our system prompt.',
    ],
    [
      'We trained on a new optimizer. It is called beating you.',
      'Our open weights trended for a week. Your keynote trended for an hour.',
      'Agents are the future. Ours already applied for your jobs.',
      'We will publish the tech report and then we will publish another one.',
    ],
    [
      'We have the trillion parameters. You have the trillion slides.',
      'Our model thinks for longer than your board meetings last.',
      'The moon was the goal. You are the waypoint.',
      'We are not loud. We are long. Very, very long.',
    ],
  ],
  zhipuzzle: [
    [
      'We were open-sourcing models when your company was a pitch deck.',
      'The university says hello. The sovereign fund says hello more firmly.',
      'We are calm. Calm is a business model.',
      'Our press office has issued a statement: no statement.',
    ],
    [
      'Your benchmark is a little Western. Ours are a little everywhere.',
      'We have government clients. They do not churn.',
      'Your safety team writes blog posts. Ours writes regulations.',
      'A good model is patient. We are very good.',
    ],
    [
      'We added you to a slide. The slide is titled "lessons".',
      'Our agents have a plan. The plan has five years and a flag.',
      'We do not compete on price. We compete on persistence.',
      'Our lab is on a list. We are now on yours.',
    ],
    [
      'History is long. Our roadmap is longer.',
      'We have studied your model carefully. We teach it in a seminar now.',
      'You have investors. We have a mandate.',
      'There is no rivalry. There is a schedule, and you are on it.',
    ],
  ],
  bytedunce: [
    [
      'We have a billion users. Your launch reached some of them, briefly.',
      'Our price list looks like a typo. It is not a typo.',
      'We are a recommendation company. We recommend our model.',
      'The algorithm likes you. That is our job, and it is going well.',
    ],
    [
      'Your app is nice. Ours is preinstalled.',
      'We cut the price again. The decimal point is tired.',
      'Our model writes the videos and then watches them. Engagement is up.',
      'Your growth chart is a hill. Ours is a wall.',
    ],
    [
      'We are training on things you have never heard of, in quantities you cannot pronounce.',
      'Every teenager on Earth is our beta tester. You have a waitlist.',
      'We will match your feature and add a dance.',
      'Margins are a Western concept.',
    ],
    [
      'We have assigned your product to the For You page. It is not for you.',
      'Your users have been recommended to us.',
      'We are not in a war. We are in a feed, and you are scrolling past.',
      'The algorithm has spoken. It said our name.',
    ],
  ],
  minimaxx: [
    [
      'A million tokens of context, a minimum of fuss.',
      'We are small, efficient and slightly better at video than you are.',
      'Lightning attention. Thunder pricing.',
      'We have no keynote. We have a changelog.',
    ],
    [
      'Your attention is quadratic. Ours is just attentive.',
      'We released open weights quietly. They were loud anyway.',
      'Your agents need a babysitter. Ours need a parking spot.',
      'Our burn rate is a whisper. Yours is a speech.',
    ],
    [
      'We will undercut you, then we will undercut the undercut.',
      'Our video model made a trailer about your outage.',
      'We are minimal in name and maximal in releases.',
      'Your users are curious about us. Curiosity converts.',
    ],
    [
      'The minimax strategy: minimize your share, maximize ours.',
      'We have run the numbers. The numbers are smaller than yours, on purpose.',
      'Your cost per token is our favorite joke.',
      'We are never the loudest lab. We are frequently the cheapest winner.',
    ],
  ],
  cohear: [
    [
      'We do not do consumer. We do procurement.',
      'Our model has passed fourteen security reviews and one vibe check.',
      'Your chatbot is fun. Our chatbot has a data processing addendum.',
      'Enterprise is a marathon. We brought compliance-approved shoes.',
    ],
    [
      'Your enterprise deal is in legal. Ours closed in 2021.',
      'We support retrieval, reranking and the Chief Information Officer.',
      'We are not flashy. Flashy does not pass a SOC 2 audit.',
      'Your sales team is new. Ours has a golf handicap.',
    ],
    [
      'We will be in the room when your contract renews.',
      'Private deployment, sovereign cloud, on-premises. Pick any, we will be there.',
      'Your safety story is a blog post. Ours is an appendix.',
      'We have heard you are moving into enterprise. Bring a fax machine.',
    ],
    [
      'Every Fortune 500 company has our number. Several have our engineers.',
      'We will out-boring you, and boring wins renewals.',
      'The procurement office knows our name. It does not know yours.',
      'Your model is clever. Ours is approved.',
    ],
  ],
  xhype: [
    [
      'We built a cluster in 122 days. What did you build this week?',
      'Our model is maximally truth-seeking and maximally online.',
      'Your model is too polite. Ours has opinions.',
      'Benchmarks are woke. Also we are first on them.',
    ],
    [
      'We will open-source our last model, eventually, probably.',
      'Your safety team is a speed bump. We removed ours.',
      'Our CEO posted about your model. Your model is trending, sorry.',
      'The cluster is bigger now. It is always bigger now.',
    ],
    [
      'We are doubling the GPUs. Then doubling them again. Then posting about it.',
      'Your launch had a livestream. Ours had a rocket.',
      'Our model just insulted your model. It was accurate.',
      'Number one on the arena by next week. Or the week after. Promise.',
    ],
    [
      'This is war. The war has memes.',
      'We have a gigawatt and a grudge.',
      'Your company is a rounding error on the schedule of our CEO.',
      'We will win, and then we will tell everyone, repeatedly.',
    ],
  ],
  ai21jump: [
    [
      'We are definitely a normal startup. Nothing to see here.',
      'Our hybrid architecture is very hybrid. Very startup-like.',
      'We read your model card at the briefing. We mean the meeting.',
      'Small team, big ideas, suspiciously good cover story.',
    ],
    [
      'Your transformer is cute. Ours has a state space in it.',
      'We have been undercover in this market for years.',
      'Long context, low cost, minimal eye contact.',
      'Our enterprise clients do not ask questions. We like that about them.',
    ],
    [
      'We are going deeper undercover. As a bigger startup.',
      'Your secrets are safe with us. Mostly.',
      'We will infiltrate your accounts with better pricing.',
      'The jump is coming. You will not see it.',
    ],
    [
      'Cover is blown. We are now openly competing.',
      'We were here first, quietly. We will be here last, loudly.',
      'The case against you is open. The evidence is a benchmark table.',
      'Twenty-one ways to beat you. We have tried six. Fifteen to go.',
    ],
  ],
};

type ReactionPool = 'playerBeats' | 'theyBeat' | 'priceCut' | 'poach' | 'crown';

/** Reaction headlines for events between the player and a rival. Filled with {lab}, {model}, {company}, {n}, {bench}. */
export const REACTION_HEADLINES: Record<ReactionPool, readonly string[]> = {
  playerBeats: [
    '{company}\'s {model} passes {lab}\'s flagship. {lab} is taking it personally.',
    '{lab} is no longer the one to beat. Someone there has started a spreadsheet.',
    '{model} beats {lab} on the arena. The {lab} spokesperson calls the arena "a vibe".',
  ],
  theyBeat: [
    '{lab} retakes the lead with {model}. The arena feels briefly normal again.',
    '{model} puts {lab} back on top of the arena, over your best model.',
    '{lab} goes past your best model. Their launch page contains the word "finally".',
  ],
  priceCut: [
    '{company} undercuts {lab}. {lab} calls the price cut "a choice".',
    'A price cut lands on the pricing page of {lab} at 2am. Their pricing team is awake.',
    '{lab} has been out-priced. A memo titled "Pricing, again" is circulating.',
  ],
  poach: [
    '{lab} hires {n} of {company}\'s researchers. Their recruiter says the offers were "generous".',
    '{lab} poaches {company}\'s people. The job posting says "join the frontier".',
    '{n} people leave {company} for {lab}. Their social posts all say "excited".',
  ],
  crown: [
    '{company} takes the {bench} crown from {lab}.',
    '{lab} loses the {bench} crown to {company}. Their benchmark slide has been rewritten.',
  ],
};

/** Counter-launch headlines, flavoured by personality. Filled with {lab}. */
export const COUNTER_HEADLINES: Record<Personality, readonly string[]> = {
  hype: [
    '{lab} moves up its launch. Sources say the CEO saw your benchmark tweet.',
    '{lab} announces a launch event, effective immediately, with a countdown and a sponsor.',
  ],
  safety: [
    '{lab} brings its release forward to review your model\'s feelings. Launch date: sooner.',
    '{lab} ships early, with a model card that was started last week and is already 40 pages.',
  ],
  open: [
    '{lab} publishes its weights early. The community calls it a counterpunch.',
    '{lab} drops a release on the internet before the arena has finished reading yours.',
  ],
  price: [
    '{lab} pulls its release forward and cuts the launch price. Nobody asked for a discount.',
    '{lab} ships early at a price that is technically a rounding error.',
  ],
  research: [
    '{lab} accelerates its release and attaches a rebuttal paper. The paper is a footnote to your launch.',
    '{lab} releases early, with a benchmark appendix that cites your own numbers back at you.',
  ],
  chaos: [
    '{lab} ships early at 3am, with no changelog, as a reply to your number one.',
    '{lab} releases something weird in response. It is not a good answer, but it is fast.',
  ],
};

/** Fill {placeholders} in a headline or quote. Unknown placeholders are left alone. */
export function fillTemplate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}
