export const SET_TYPES = {normal: '普通', warmup: '热身', drop: '递减'};
export const EFFORT_DISPLAYS = ['off', 'rpe', 'rir'];
export function setTypeOf(set) {
  const type=set?.performance?.setType;
  return typeof type==='string'&&Object.hasOwn(SET_TYPES,type)?type:null;
}
export const isWorkingSet = set => setTypeOf(set) === 'normal';

const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const hasKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validatePerformance(value) {
  if (!hasKeys(value, value?.effortBasis === undefined ? ['schemaVersion', 'setType', 'toFailure', 'effort'] : ['schemaVersion', 'setType', 'toFailure', 'effort', 'effortBasis'])
    || value.schemaVersion !== 1 || typeof value.toFailure !== 'boolean'
    || !(value.setType === null || typeof value.setType === 'string' && Object.hasOwn(SET_TYPES, value.setType))) {
    throw Error('组类型或强度记录格式不受支持。');
  }
  const {effort, effortBasis} = value;
  if (effort === null && effortBasis === undefined) return true;
  if (hasKeys(effort, ['kind', 'rpe']) && (
    effort.kind === 'exact' && finite(effort.rpe, 5, 10) && Number.isInteger(effort.rpe * 2)
    || effort.kind === 'at_most' && effort.rpe === 5
  ) && hasKeys(effortBasis, ['weight', 'reps', 'bodyWeightKg']) && finite(effortBasis.weight, 0, 10000)
    && Number.isInteger(effortBasis.reps) && finite(effortBasis.reps, 1, 999)
    && (effortBasis.bodyWeightKg === null || finite(effortBasis.bodyWeightKg, .01, 1000))) return true;
  throw Error('组强度或评分对应的重量和次数无效。');
}

const basisOf = set => ({weight: set.weight, reps: set.reps, bodyWeightKg: set.load?.bodyWeightKg ?? null});

export function setPerformance(set, {setType, toFailure, effort}, confirmEffort = false) {
  if (setType === null && toFailure === false && effort === null) {
    delete set.performance;
    return;
  }
  const prior = set.performance;
  // An older app can edit the set while preserving unknown fields. Keep the
  // original rating basis until the user picks a new rating or confirms it.
  const reuseBasis = !confirmEffort && !!prior?.effort && prior.effort.kind === effort?.kind && prior.effort.rpe === effort?.rpe;
  const performance = {schemaVersion: 1, setType, toFailure, effort};
  if (effort !== null) performance.effortBasis = reuseBasis ? prior.effortBasis : basisOf(set);
  validatePerformance(performance);
  set.performance = structuredClone(performance);
}

export function performanceDetails(set) {
  if (!set.performance) return null;
  const {setType, toFailure, effort, effortBasis} = set.performance;
  const current = basisOf(set);
  const effortNeedsConfirmation = !!effort && (effortBasis?.weight !== current.weight
    || effortBasis?.reps !== current.reps || effortBasis?.bodyWeightKg !== current.bodyWeightKg);
  return {setType, toFailure, effort: effortNeedsConfirmation || !effort ? null : {...effort}, effortNeedsConfirmation};
}

export function effortLabel(effort, mode) {
  if (effort.kind === 'at_most') return mode === 'rir' ? 'RIR 5+' : 'RPE ≤5';
  return mode === 'rir' ? 'RIR ' + (10 - effort.rpe) : 'RPE ' + effort.rpe;
}

export function performanceCounts(details) {
  const counts = {normal: 0, warmup: 0, drop: 0, unclassified: 0, failureMarked: 0, rated: 0, effortNeedsConfirmation: 0};
  for (const item of details) {
    counts[item?.setType ?? 'unclassified']++;
    if (item?.toFailure) counts.failureMarked++;
    if (item?.effort) counts.rated++;
    if (item?.effortNeedsConfirmation) counts.effortNeedsConfirmation++;
  }
  return counts;
}

export function trainingSetCounts(sets) {
  return {totalRecordedSets: sets.length, ...performanceCounts(sets.map(performanceDetails))};
}

export function performanceCountText(counts, showEffort = true) {
  const types = `普通工作组 ${counts.normal} · 热身 ${counts.warmup} · 递减 ${counts.drop} · 未分类 ${counts.unclassified}`;
  const flags = ` · 力竭标记 ${counts.failureMarked}`;
  const rating = showEffort ? ` · 已评分 ${counts.rated}${counts.effortNeedsConfirmation ? ` · 评分待确认 ${counts.effortNeedsConfirmation}` : ''}` : '';
  return types + flags + rating;
}
