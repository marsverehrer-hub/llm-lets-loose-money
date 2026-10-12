import type { RoleDef, OfficeTier, Star } from '../types';
// OWNER: Agent A.
export const ROLES: RoleDef[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    plural: 'Researchers',
    baseSalary: 180_000,
    hireCost: 15_000,
    description: 'Reads papers, writes papers, occasionally trains a model.',
    icon: '🔬',
  },
  {
    id: 'engineer',
    name: 'Engineer',
    plural: 'Engineers',
    baseSalary: 150_000,
    hireCost: 10_000,
    description: 'Keeps the cluster alive and the notebooks running.',
    icon: '🛠️',
  },
  {
    id: 'safety',
    name: 'Safety Researcher',
    plural: 'Safety Team',
    baseSalary: 140_000,
    hireCost: 10_000,
    description: 'Writes the rubric for "be nice". Sighs a lot.',
    icon: '🛡️',
  },
  {
    id: 'sales',
    name: 'Sales Rep',
    plural: 'Sales Team',
    baseSalary: 110_000,
    hireCost: 8_000,
    description: 'Sells the future, one enterprise demo at a time.',
    icon: '💼',
  },
  {
    id: 'marketing',
    name: 'Marketer',
    plural: 'Marketing Team',
    baseSalary: 100_000,
    hireCost: 8_000,
    description: 'Turns "it predicts the next token" into "it thinks".',
    icon: '📣',
  },
];

// Ordered smallest to largest. OFFICE_TIERS[0] is where the company starts.
export const OFFICE_TIERS: OfficeTier[] = [
  { id: 'garage', name: "Mom's Garage", capacity: 6, cost: 0, rentPerDay: 30, flavor: 'Smells of WD-40 and ambition. Mom says the rent is fine.' },
  { id: 'wework', name: 'WeWork Hot Desks', capacity: 20, cost: 50_000, rentPerDay: 400, flavor: 'Free kombucha on tap. Everyone is someone\'s "community".' },
  { id: 'soma', name: 'SoMa Loft', capacity: 60, cost: 400_000, rentPerDay: 1_500, flavor: 'Exposed brick, a slide nobody uses and a ping-pong table with a waitlist.' },
  { id: 'missionbay', name: 'Mission Bay Floors', capacity: 200, cost: 3_000_000, rentPerDay: 6_000, flavor: 'Three floors, two cafes and a meditation room that is always booked.' },
  { id: 'donut', name: 'Glass Donut Campus', capacity: 1_000, cost: 50_000_000, rentPerDay: 40_000, flavor: 'A ring of glass around a park. The park is also yours, legally.' },
  { id: 'arcology', name: 'Arcology', capacity: 10_000, cost: 1_000_000_000, rentPerDay: 300_000, flavor: 'A city that happens to contain your office. Please do not ask about the zoning.' },
];

/** Templates for star hires that appear on the market over time (id, hiredDay and loyalty are assigned at spawn). */
export const STAR_TEMPLATES: Omit<Star, 'id' | 'hiredDay' | 'loyalty'>[] = [
  {
    name: 'Dr. Gradient Descenz',
    role: 'researcher',
    title: 'Ex-Gugle Distinguished Research Scientist (Retired Twice)',
    salary: 2_500_000,
    bonuses: { researchSpeed: 1.3 },
  },
  {
    name: 'Mo Parameterz',
    role: 'researcher',
    title: 'Former Head of Scaling Vibes',
    salary: 2_000_000,
    bonuses: { trainingSpeed: 1.2 },
  },
  {
    name: 'Imogen Attention',
    role: 'researcher',
    title: 'Head of Attention (All of It)',
    salary: 1_800_000,
    bonuses: { researchSpeed: 1.2, trainingSpeed: 1.1 },
  },
  {
    name: 'Yuki Tokenstein',
    role: 'researcher',
    title: 'Tokenizer Savant, Three Startups Deep',
    salary: 1_500_000,
    bonuses: { dataQuality: 1.15 },
  },
  {
    name: 'Chad Overfitson',
    role: 'engineer',
    title: 'Principal Staff Engineer, Kubernetes Whisperer',
    salary: 1_200_000,
    bonuses: { inferenceEfficiency: 1.25 },
  },
  {
    name: 'Zoltan Vectorsson',
    role: 'engineer',
    title: 'Distributed Systems Wizard (Ex-Mainframe)',
    salary: 1_100_000,
    bonuses: { trainingSpeed: 1.15 },
  },
  {
    name: 'Mira Latencia',
    role: 'engineer',
    title: 'Head of Latency Reduction (Latency Unchanged)',
    salary: 1_000_000,
    bonuses: { inferenceEfficiency: 1.2 },
  },
  {
    name: 'Oskar Benchmarkson',
    role: 'safety',
    title: 'Chief Red Team Lead (Formerly Unpaid Intern)',
    salary: 900_000,
    bonuses: { safety: 1.25 },
  },
  {
    name: 'Sigrid Alignment',
    role: 'safety',
    title: 'Head of Alignment Theater',
    salary: 1_000_000,
    bonuses: { safety: 1.3 },
  },
  {
    name: 'Rex Quota',
    role: 'sales',
    title: 'VP of Enterprise Vibes',
    salary: 850_000,
    bonuses: { sales: 1.4 },
  },
  {
    name: 'Tabitha Hypeworth',
    role: 'marketing',
    title: 'Chief Viral Officer',
    salary: 800_000,
    bonuses: { brand: 1.3 },
  },
  {
    name: 'Hugo Keynote',
    role: 'marketing',
    title: 'Keynote Enthusiast, Conference Circuit Veteran',
    salary: 750_000,
    bonuses: { brand: 1.2 },
  },
];
