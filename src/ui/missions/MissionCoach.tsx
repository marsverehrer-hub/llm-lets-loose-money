// The running mission's sticky note. App mounts it (lazily) only while a mission runs.
import { useEffect } from 'preact/hooks';
import { navigate } from '../nav';
import { Button } from '../components';
import { useGame } from '../store';
import { showNotice } from '../unlocks';
import { CoachCard } from '../tutorial/Tutorial';
import { advanceMission, endMission, useMissionRun } from './missions';

export function MissionCoach() {
  const s = useGame();
  const run = useMissionRun();
  const step = run?.mission.steps[run.step];
  const title = run?.mission.title ?? '';
  const next = () => {
    if (advanceMission()) showNotice(`Mission complete: ${title}.`);
  };

  // Each step takes the player to its screen, so the control it names is on screen.
  useEffect(() => {
    if (step) navigate(step.go, step.intent);
  }, [run?.mission.id, run?.step]);

  // Runs after every store change. A new company or another save makes the snapshot meaningless, so the mission ends.
  useEffect(() => {
    if (!run || !step) return;
    if (s.seed !== run.base.seed) endMission();
    else if (step.done?.(s, run.base)) next();
  });

  if (!run || !step || s.gameOver) return null;
  const last = run.step === run.mission.steps.length - 1;
  const byHand = !step.done;

  return (
    <CoachCard
      def={step}
      label={`${run.mission.title}, ${run.step + 1} of ${run.mission.steps.length}`}
      actions={
        <>
          {byHand && (
            <Button variant="primary" size="sm" onClick={next}>
              {last ? 'Done' : 'Next ›'}
            </Button>
          )}
          <Button variant={byHand ? 'default' : 'primary'} size="sm" onClick={() => navigate(step.go, step.intent)}>
            Go ›
          </Button>
          <Button variant="ghost" size="sm" class="tut-skip" onClick={endMission}>
            Close
          </Button>
        </>
      }
    />
  );
}
