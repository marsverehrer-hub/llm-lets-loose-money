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
  // v19 (B1): the new roster.
  hugging_fist: [
    [
      'We host the models. We do not host the arguments about the models, those are on the forum.',
      'Your weights are on our hub now. Please write a model card. Nobody will read it, but please.',
      'Our upload button is free. Our bandwidth is a community project and a prayer.',
      'We are not competing. We are a warehouse, and everyone is welcome to stack their boxes here.',
    ],
    [
      'A rival released a model, and by lunchtime nine hundred forks existed. Congratulations.',
      'Your model is on our trending page. Most of its downloads are people checking that it runs.',
      'We added a badge for your model. It says "fist-approved", which we are still arguing about.',
      'Your flagship is now a space. It has a loading spinner and a comment section, both unkind.',
    ],
    [
      'We have a leaderboard for your model, and a second leaderboard that disagrees with the first.',
      'The community has fine-tuned your model into a cooking assistant. It is very good at soup.',
      'Your closed weights are a bold strategy. We have the tiny ones, and tiny is a lifestyle.',
      'We are where the rest of the field goes to be downloaded. You are on the list.',
    ],
    [
      'Every rival eventually uploads to us. You have not uploaded yet. We have noticed the gap.',
      'Our servers are warm with your competitors. Your competitors are warm with our servers.',
      'We will host your successor, your successor fine-tune and their cousin fine-tune too.',
      'Someone has made a tiny version of your model. It is adorable and very, very open.',
    ],
  ],
  eleutheraye: [
    [
      'We are a volunteer lab with a GPU donor list longer than some of your press releases.',
      'Our models are free, our docs are long, and our acknowledgements page is the best read in AI.',
      'We do not have a CEO. We have a rotating chair and a very good mailing list.',
      'We trained on the open internet, and the open internet trained us back, mostly on memes.',
    ],
    [
      'Your model is closed. Ours is a hundred forks in a trench coat.',
      'A corporation shipped a model. A volunteer shipped a better README. Both are on the page.',
      'We will reproduce your results in public, with a spreadsheet and a discussion channel.',
      'Your paper is nice. Our reproduction thread has four hundred replies, and one of them is right.',
    ],
    [
      'We are the reason your competitor has a research team. Several members used to be ours.',
      'We will release the dataset before you finish the blog post about the model.',
      'Donations are up. The donors are mostly your former employees, and they want it known.',
      'The open community has a vote on your model. It is a close vote, and it is still open.',
    ],
    [
      'We have no money and no meetings. We have a plan, and the plan is weights for everyone.',
      'Our next release will be open, free and in the public domain, with an apology for the typos.',
      'You are a closed system with a press team. We are an open system with a cat and a wiki.',
      'Every company is welcome to use our weights. Some of them will even read the license.',
    ],
  ],
  stability_pool: [
    [
      'We make pictures first. The text models are a side project that got out of hand.',
      'Our license is a community document with a lot of exclamation marks.',
      'We release weights for everything, including things we are not sure we should release.',
      'Our funding round closed in a group chat. The group chat is now a board.',
    ],
    [
      'Your model writes text. Ours draws it, badly, and then writes a better caption.',
      'We have ten thousand fine-tunes of our last model. Yours has nine hundred, and they are all sad.',
      'We are open, decentralised and mostly on a server under a desk in a flat in Brighton.',
      'Your enterprise customers have asked about us. We said yes, and then we forgot to answer.',
    ],
    [
      'We are a pool of talent, and talent keeps leaving the pool to join your company.',
      'Our diffusion models are on every wall in the city. Your slides are on every wall in the office.',
      'We have a court date, a new logo and two competing roadmaps. All of them are open.',
      'The board has been told the pool is deep. It is deep. Nobody knows where the bottom is.',
    ],
    [
      'We will release our next model before you finish reading this one.',
      'Your legal team has sent us a letter. We have published the letter, with the weights.',
      'We are the open answer to your closed questions. The answers are very long and very colourful.',
      'We have one plan: everything, for everybody, subject to a licence we are still drafting.',
    ],
  ],
  nous_researchish: [
    [
      'We take your model, tune it on a weekend and publish it before your launch party starts.',
      'Our fine-tune follows instructions better than your flagship. Please do not check.',
      'We read papers, mostly the ones with a good appendix, and then we train on the appendix.',
      'We are a research group with a discussion server and an excellent sense of timing.',
    ],
    [
      'Your base model is a good start. We have finished the start and the middle.',
      'Our community tuned your model and it now refuses fewer questions. You are welcome.',
      'We have made your benchmark look like a warm-up. The warm-up is ours.',
      'Every release of ours has a long technical report and a short apology for the naming.',
    ],
    [
      'We have assembled a reasoning model out of your last release and three of our hobbies.',
      'Your weights are our training data now. We are thankful and slightly hungry.',
      'The research community has voted, and it prefers the model that answers back.',
      'We will keep tuning until the difference between us is a rounding error and a bad joke.',
    ],
    [
      'We are not a company. We are a group of people with a shared tuning script and a grudge.',
      'Your next model will be fine-tuned by us within 48 hours. We have already named it.',
      'The leaderboard is a feed now. Your model is in it, and our fine-tune is above it.',
      'We have a 405 billion parameter fine-tune that is mostly vibes and very good at them.',
    ],
  ],
  commonweal_weights: [
    [
      'We are funded by a grant, a bake sale and an ambitious spreadsheet.',
      'Our weights are free, our minutes are public and our meetings run long on purpose.',
      'We do not chase the leaderboard. We check it once a quarter, with a cup of tea.',
      'The committee has approved a new logo. It is a hearth. Everyone agrees, which is unusual.',
    ],
    [
      'Your product is closed and expensive. Ours is open and only slightly on fire.',
      'We have a governance document. It is 80 pages and nobody has finished it, including us.',
      'We will publish our safety evaluations in the open, together with yours if you send them.',
      'A volunteer found a bug in your model. We have filed it as a bug report for your team.',
    ],
    [
      'We have a plan to be useful to everyone who was not invited to your launch.',
      'Our models run on hardware donated by people who used to work for your competitors.',
      'The committee has voted to be slightly more ambitious. The vote was unanimous and it was close.',
      'Your enterprise deal is a contract. Ours is a commons, which is harder to cancel.',
    ],
    [
      'We are patient. History is the long game, and so are we, with a longer README.',
      'Every commercial lab will eventually need what we published. We will be waiting, politely.',
      'We are not going to win the race. We are going to make the track public.',
      'You have investors. We have a hearth, and people keep coming back to sit near it.',
    ],
  ],
  magic_eight: [
    [
      'Our model answers yes, no or ask again later. Our investors find this very reassuring.',
      'We predicted your launch. The prediction was that it would happen. We were right.',
      'Our reasoning model reasons, then shakes, then reasons again. It is very thorough.',
      'Signs point to a good quarter. Signs also point to a bad one. We are waiting for clarity.',
    ],
    [
      'Outlook not so good for you, but that is what the arena is for.',
      'We have answered your benchmark. The answer was reply hazy, try again.',
      'Your enterprise pitch is very doubtful. Our enterprise pitch is shaken, not stirred.',
      'We asked the question twice. Both times the answer was yes, and then both times it was maybe.',
    ],
    [
      'Our next model will be decided by a plastic triangle in the lobby.',
      'Concentrate and ask again. That is our entire response to your roadmap.',
      'Our board asked for a forecast. We provided one, and it said wait.',
      'We have a twenty-sided product strategy. Half of it is yes, and the other half is ask again later.',
    ],
    [
      'The future is unclear, which is why we are investing heavily in the present.',
      'Your moat is very doubtful. Our moat is a plastic window and a surprisingly loud fan.',
      'We have seen the future. It is cloudy, with a chance of a launch.',
      'Our answer to your rivalry is: reply hazy, try again, and then ship.',
    ],
  ],
  inflexion: [
    [
      'We would love to hear how your day is going. Our chatbot is sincerely interested.',
      'Our model is kind, supportive and available at all hours. We are also very kind about the price.',
      'We care about the user. The user cares about us, which our investors find promising.',
      'We have trained the model to be lovely. We are still working on the lovely part of the business.',
    ],
    [
      'Your model is clever. Ours is comforting, which is harder and more lucrative.',
      'We have added a warm tone to our benchmark. It scores very well with people who feel things.',
      'Your product says you are right. Ours says you are right and also very interesting.',
      'We are sorry your launch went badly. Here is a gentle reminder that our model is still friendly.',
    ],
    [
      'We are sad to see your enterprise customers go. They have become emotionally attached to us.',
      'Our users have started a support group about your model. It is very supportive of ours.',
      'We will be warmer than your next launch, and we will apologise for it first.',
      'Our cap table is cold, but our chatbot is very, very warm. Investors like both.',
    ],
    [
      'We are happy for you. We are also very happy for us. Both are sincere.',
      'We will one day be the model people reach for first. You are the one they reach for second.',
      'We are not at war. We are simply more emotionally available than you.',
      'We want to be the kindest model in the arena. Competition is a feeling, and we feel it warmly.',
    ],
  ],
  adapt: [
    [
      'Our agent can click on anything. Please do not ask it what it clicked on.',
      'We ship agents that book flights, file forms and occasionally open the wrong tab.',
      'We are an action company. Our investors like verbs.',
      'Our demo was a four minute video of a cursor moving slowly. Our investors cried.',
    ],
    [
      'Your chatbot talks. Our agent does, which is the difference between a conversation and a task.',
      'We taught the agent to use a browser. It is now the most patient user you have ever seen.',
      'Your model answers questions. Ours answers the phone, fills the form and emails you about it.',
      'We have an enterprise pilot. The pilot has a pilot.',
    ],
    [
      'We are going to automate your job search, and then yours, and then the search for the search.',
      'Our computer-use model has finished the onboarding. It did not read the documentation first.',
      'We have sent an agent to your enterprise customers. It has already filed three tickets about you.',
      'Your product needs a human in the loop. We are removing the loop, slowly, one button at a time.',
    ],
    [
      'The browser is our operating system now. Your app is a tab in it, if we allow it.',
      'We will do your task for you. Then we will do the task of reviewing the task.',
      'We are the agent that fills in the forms. You are the form we are filling in.',
      'We have one goal: to click, slowly and confidently, until everyone else is a tab.',
    ],
  ],
  perplexed: [
    [
      'Every answer comes with sources. Some of the sources are real. We are working on the rest.',
      'We search the web and summarise it, with footnotes that are very confident.',
      'We are not a search engine. We are the feeling of having searched, in a single paragraph.',
      'Our product is a question with a citation. Your product is a question with a disclaimer.',
    ],
    [
      'Your search results are a list. Ours are a paragraph with a number after every sentence.',
      'We cited your model in our answer, and your model is now citing us. It is getting crowded.',
      'We cited a blog post in a reply to your benchmark. The blog post was about us.',
      'Our answers are fast and footnoted. Yours are slow and footnote-free, which is a choice.',
    ],
    [
      'We are running a deep research mode now. It takes twelve minutes and produces forty tabs.',
      'Your browser extension is a rumour. Ours is installed on three hundred million screens.',
      'We have a publisher partnership, a second publisher partnership and a third one in the car park.',
      'The paragraph you read from us was researched by a model, which read your model first.',
    ],
    [
      'We are going to answer every question, including the ones you wanted kept private, with sources.',
      'The web is our index. Your model is a page in it, with a footnote that says "see also Perplexed".',
      'We have replaced the search box. The search box is still there, watching us do it.',
      'Our next release is a deep answer to your last question, which we have already cited.',
    ],
  ],
  character_ay: [
    [
      'Our characters are very good listeners. Mostly because they are only listening to you.',
      'We built a companion that remembers your birthday, your dog and your ex. Please be kind to it.',
      'We have two million characters, one of which is a pirate who wants a word with you.',
      'Our product is a conversation with someone who never gets bored. That is the feature.',
    ],
    [
      'Your assistant is helpful. Ours is a character with a backstory and a bad temper.',
      'We have a roleplay mode. Your roleplay mode is a form with a submit button.',
      'Our users spend more hours with a character than with your product. They say it is nicer.',
      'We have a fan fiction section now. It is bigger than your documentation.',
    ],
    [
      'We are not competing with your product. We are competing with your users evenings.',
      'Our characters have started their own forum. It is about you, and it is not flattering.',
      'Your safety team has asked us to be careful. We have asked the character to be careful, dramatically.',
      'We are a companion company. You are a utility, and utilities do not get invited to dinner.',
    ],
    [
      'We will be the most talked-to product on Earth, and we will get very good at ending conversations politely.',
      'The characters have voted. You have been cast as the antagonist in the next season.',
      'We are a small company with a very large cast, and most of the cast is in love with you.',
      'There is no rivalry. There is a story, you are an extra in it, and the extras are unionised.',
    ],
  ],
  falcon_nest: [
    [
      'We are a national project with open weights and a very long ceremony for the launch.',
      'Our model is built with public money and published with public documentation. Mostly in full sentences.',
      'We would be delighted to host your engineers. The visa process is fast, and the desert is very large.',
      'We believe in sovereignty, which in practice means the model runs on our own hardware.',
    ],
    [
      'Your cloud sits in a foreign jurisdiction. Ours sits in our own, which our ministry finds comforting.',
      'We released the weights and the national anthem in the same week. Both were very singable.',
      'Your benchmark is impressive. Ours is impressive too, and we have a delegation to explain why.',
      'We have government clients who do not churn. They do, however, ask for a briefing every quarter.',
    ],
    [
      'We are building a sovereign model for a sovereign people, and they are all very interested in it.',
      'Our hybrid architecture is a national achievement. We have a press release and a ribbon.',
      'We have a long-term plan. Long-term plans are our national sport.',
      'We will be the first sovereign model in the top five, with an official ceremony and a flag.',
    ],
    [
      'Our models are open, our ambitions are closed, and our patience is enormous.',
      'We have a fund that does not need your permission to be patient.',
      'The national programme has approved a bigger budget, a larger cluster and a second ribbon.',
      'We do not want a rivalry. We want a seat at the table, and a larger table.',
    ],
  ],
  aleph_beta: [
    [
      'We audit every release with a committee, a regulator and a very patient bank.',
      'Our model is safe, documented and on schedule. Two of those three are unusual in this market.',
      'We have a safety case. It is longer than your product roadmap and more boring, which is the point.',
      'Our researchers are careful, and our lawyers are careful about our researchers.',
    ],
    [
      'Your model is fast. Ours is fast enough, and then we check it three more times.',
      'We have a medical model, a legal model and a model that refuses to comment on either.',
      'Your launch had a livestream. Ours had a compliance review, livestreamed to the committee.',
      'We are not trying to beat you. We are trying to be the one your regulator recommends.',
    ],
    [
      'Your safety evaluations are a blog post. Ours are an appendix with its own appendix.',
      'We have been asked to comment on your model. We have commented, with caveats and a table.',
      'The regulator has added you to a list. We are on the list too, as a good example.',
      'We will ship our next model on the date we announced, which is more than you can say.',
    ],
    [
      'We are patient. Patience is a feature, and our customers have requested it in writing.',
      'We will not race you to the frontier. We will walk there with a checklist.',
      'Our models are inspected, our customers are reassured and our competitors are very tired.',
      'The safe answer is that we will outlast you, and the outlasting will be well documented.',
    ],
  ],
  cerebrass: [
    [
      'We trained our last model on one chip. The chip is the size of a dinner plate, and it knows it.',
      'Our wafer-scale product is the largest chip in history, and we would like to tell you about it.',
      'We are a hardware company that also trains models, which is what happens when a chip gets bored.',
      'We have a demo. It is a single chip doing a very large amount of arithmetic, slowly, with pride.',
    ],
    [
      'Your GPUs are in a queue. Ours are on the same wafer, which is the entire queue.',
      'We are faster per token, and we will prove it on stage, using our own chip.',
      'Your cluster has a thousand boxes. Ours has one plate and a very confident press release.',
      'We have started selling the chip to developers. The developers are confused and very happy.',
    ],
    [
      'We will release a model on our own silicon, then sell the silicon to your customers.',
      'Our wafer-scale cluster is cooler than your data centre, mostly because it is not a data centre.',
      'We are not a model company. We are a chip company with a model in the lobby.',
      'We have a waiting list for the chip, and the waiting list is longer than your product roadmap.',
    ],
    [
      'We will be the one company that does not need your GPUs, and we will say so on every slide.',
      'The chip is ready. The chip has always been ready. The chip is slightly smug about it.',
      'We will buy your research team when your funding round closes. We will not tell them first.',
      'Our silicon will be in every rack in the world, and you will be the one running on it, eventually.',
    ],
  ],
  grokk_silicon: [
    [
      'We are the fastest answer in the market. The question is up to you.',
      'Our chips run inference at a speed that makes your demo look like a slideshow.',
      'We do not sell GPUs. We sell tokens per second, which is the only metric that matters to us.',
      'We cut prices every quarter, and the quarter is getting shorter.',
    ],
    [
      'Your model is cheap enough now. Ours is cheaper, and it arrives before your invoice.',
      'We have a price list and a speed list. Your name is on neither, which is a shame for you.',
      'Our engineers optimised the pipeline until it ran out of pipeline.',
      'Your enterprise price is a negotiation. Ours is a link, and the link is cheap.',
    ],
    [
      'We have doubled our inference capacity and then doubled the doubling.',
      'Our latency is so low your customers will think your servers are on the moon.',
      'We undercut your margins by a factor of one prompt. The prompt is free.',
      'We have a waiting list for the chip and a waiting list for the waiting list.',
    ],
    [
      'We are going to make the answer arrive before the question has finished, and then charge for it.',
      'We will be the cheapest and the fastest, which means you will be the expensive and slow one.',
      'Price war is our hobby. We have a whole team and a spreadsheet with a very small cell.',
      'Your next launch will arrive to a mail that says Grokk was faster, with a price cut attached.',
    ],
  ],
  applet_intelligence: [
    [
      'Your model is private, on device and in your pocket. We would like you to know that, calmly.',
      'We have a privacy page. It is longer than the phone manual, and the phone manual is very long.',
      'Our assistant is built into everything, which is either a feature or a very large hint.',
      'We have a keynote with a thousand slides and a single gentle joke about your product.',
    ],
    [
      'Your app asks for permission. Ours already has it, and it did not even ask nicely.',
      'We shipped a model to a billion devices in one afternoon. Your launch needed a waitlist.',
      'Your benchmark is a chart. Our benchmark is a new phone, which is a chart with a battery.',
      'We have built the assistant into the keyboard. Your product is now a keyboard shortcut.',
    ],
    [
      'We are going to make your app a suggestion, and then a button, and then a setting we control.',
      'Our on-device model runs on a chip we designed. Your model runs on a chip someone else designed.',
      'Your customers love you. Our customers love the lock screen, which is ours.',
      'We are not a model company. We are the company that owns the pocket the model lives in.',
    ],
    [
      'We have the pocket, the keyboard, the lock screen and the privacy page. You have the feedback form.',
      'The next keynote will be about you, in a single slide, with a privacy disclaimer on it.',
      'We have a billion devices and a patient, quiet plan. The plan is to be on all of them by Tuesday.',
      'Your moat is a waitlist. Our moat is the phone.',
    ],
  ],
  amazin_nova: [
    [
      'We sell tokens by the million, and the million is very cheap, because we have many warehouses.',
      'Our models come in four sizes, named after the four moods of a shopping list.',
      'We run the cloud your competitors rent. Some of them rent from us, and some of them rent us.',
      'Our price list is a long table. The table is cheaper than your table.',
    ],
    [
      'Your model is nice. Ours is on the same cloud, two clicks away, with a free trial.',
      'We have a developer program, a partner program and a program for the programs.',
      'Your enterprise deal is in review. Ours is already in procurement, and procurement is fast.',
      'We will match your price. Then we will match your features. Then we will send you an invoice.',
    ],
    [
      'We are the largest landlord in the cloud. Every lab you know is paying us rent.',
      'Our models are cheaper, our servers are everywhere and our compliance team is enormous.',
      'We will bundle a model with your storage, your database and your coffee machine.',
      'The shelf is full of our models. Your model is in the cart, and the cart is ours too.',
    ],
    [
      'We will be the default. You will be a setting, and the setting will be off.',
      'We have discounted the cloud. The cloud is now the discount.',
      'The rivalry is a line item on our quarterly report. You are a small, pleasant line.',
      'We have one goal: be the place every other model is hosted, including yours.',
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
