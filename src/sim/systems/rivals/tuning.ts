// v19: every number the rival-lab simulation uses. Single source of truth; balance tuning happens here.
export const RIVAL_TUNING = {
  /** The brain acts once every this many days. */
  BRAIN_EVERY_DAYS: 7,
  /** Most labs active at once; later foundings wait for a slot. */
  MAX_ACTIVE: 12,
  /** Days in a row below zero cash before a lab goes bankrupt. */
  BANKRUPT_DAYS: 60,
  /**
   * Release quality = lerp(physics, frontier curve + lab offset, ANCHOR). 0 = pure physics, 1 = the old fixed curve.
   * Keeps the balance targets while each lab's own compute, data and research move it.
   */
  ANCHOR: 0.5,
  /** Effective-compute multiplier for rivals (calibration knob). */
  EFFICIENCY: 1,
  /** Fraction of a lab's GPUs used for training (the rest serves its users). */
  TRAINING_SHARE: 0.6,
};
