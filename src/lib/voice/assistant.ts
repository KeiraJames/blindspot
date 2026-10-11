import { create } from 'zustand';
import { useSettings } from '../../state/settings';
import { ask, say, voice } from '../feedback';

/**
 * The voice companion: one place that listens and decides what to do with what was said.
 *
 * The screen you're on gets first say (a room name on the Go screen, "start" on a route);
 * anything it doesn't handle is an app-wide command ("look around", "go back", "take me to the
 * stage"). A handler can answer with a follow-up question, which is asked straight away and
 * listened for, so a conversation keeps going without pressing anything.
 */

/** What a handler did with an utterance: a follow-up question, done (true), or not mine (false). */
export type Reply = string | boolean;
export type VoiceHandler = (heard: string) => Reply;

export interface ScreenVoice {
  handle: VoiceHandler;
  /** Words worth biasing recognition toward on this screen (room names, commands). */
  hints?: string[];
}

interface AssistantState {
  listening: boolean;
  /** The screen hides the floating Talk button (it has its own, e.g. during guidance). */
  hideButton: boolean;
}

export const useAssistant = create<AssistantState>(() => ({ listening: false, hideButton: false }));

const screens: ScreenVoice[] = [];
let navigateTo: ((to: string | -1) => void) | null = null;
let currentPath = '/';
/** A place asked for from another screen ("take me to the stage"); the Go screen picks it up. */
let pendingPlace: string | null = null;
/** When the person last spoke to the app; recent voice use keeps the conversation going. */
let lastSpokeAt = 0;
const CONVERSATION_MS = 90_000;

export function setNavigator(fn: (to: string | -1) => void, path: string) {
  navigateTo = fn;
  currentPath = path;
}

export function registerScreenVoice(v: ScreenVoice): () => void {
  screens.push(v);
  return () => {
    const i = screens.indexOf(v);
    if (i >= 0) screens.splice(i, 1);
  };
}

export function takePendingPlace(): string | null {
  const p = pendingPlace;
  pendingPlace = null;
  return p;
}

/** True while the person is talking with the app by voice, so it should keep listening. */
export const inConversation = () => Date.now() - lastSpokeAt < CONVERSATION_MS;

export const APP_HELP =
  'You can say: go somewhere, take me to a place, look around, add a room, my rooms, settings, talk slower or faster, go back, go home, repeat, or be quiet.';

export type AppCommand =
  | { type: 'open'; path: string; name: string }
  | { type: 'go'; place: string | null }
  | { type: 'back' }
  | { type: 'repeat' }
  | { type: 'speed'; delta: number }
  | { type: 'quiet' }
  | { type: 'help' }
  | { type: 'hello' }
  | { type: 'thanks' }
  | { type: 'unknown' };

/** App-wide commands, worded loosely the way people talk. */
export function parseAppCommand(heard: string): AppCommand {
  const t = heard
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .replace(/\b(please|can you|could you|i want to|i'd like to|let's|lets)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return { type: 'unknown' };
  if (/^(go )?(back|previous)\b/.test(t)) return { type: 'back' };
  if (/\b(home|main menu|start over|menu)\b/.test(t) && !/\b(to|in) (the )?home\b/.test(t))
    return { type: 'open', path: '/', name: 'Home' };
  if (
    /\b(look around|what'?s around|what is around|what'?s (in front|ahead)|what do you see|surroundings)\b/.test(
      t,
    )
  )
    return { type: 'open', path: '/look', name: 'Look around' };
  if (/\b(add|scan|new|save) (a |this |the )?room\b|\bscan\b/.test(t))
    return { type: 'open', path: '/scan', name: 'Add a room' };
  if (/\b(my rooms|rooms list|list (my |the )?rooms|rename|delete)\b/.test(t))
    return { type: 'open', path: '/rooms', name: 'My rooms' };
  if (/\b(slower|slow down)\b/.test(t)) return { type: 'speed', delta: -0.1 };
  if (/\b(faster|speed up|quicker)\b/.test(t)) return { type: 'speed', delta: 0.1 };
  if (/\bsettings?\b|\b(voice|speed)\b/.test(t)) return { type: 'open', path: '/settings', name: 'Settings' };
  if (/\b(how to use|how do i|tutorial|guide me through)\b/.test(t))
    return { type: 'open', path: '/help', name: 'How to use' };
  if (/\b(help|what can i say|commands|options)\b/.test(t)) return { type: 'help' };
  if (/\b(repeat|say that again|again|pardon|what did you say)\b/.test(t)) return { type: 'repeat' };
  if (/\b(be quiet|quiet|shush|hush|stop talking|silence|shut up)\b/.test(t)) return { type: 'quiet' };
  if (/\b(thanks|thank you|cheers)\b/.test(t)) return { type: 'thanks' };
  if (/^(hi|hello|hey)\b/.test(t)) return { type: 'hello' };
  const go =
    /\b(?:take me to|go to|navigate to|get me to|bring me to|walk me to|where is|where's|find|head to)\s+(.+)$/.exec(
      t,
    );
  if (go) return { type: 'go', place: go[1]!.replace(/^(the|a|an|my)\s+/, '') };
  if (/\b(go somewhere|navigate|directions|take me somewhere|walk)\b/.test(t))
    return { type: 'go', place: null };
  return { type: 'unknown' };
}

function runAppCommand(heard: string): Reply {
  const cmd = parseAppCommand(heard);
  switch (cmd.type) {
    case 'open':
      if (currentPath === cmd.path) return `You're already in ${cmd.name}. What would you like to do?`;
      navigateTo?.(cmd.path);
      return true;
    case 'go':
      pendingPlace = cmd.place;
      if (currentPath !== '/go') navigateTo?.('/go');
      return true;
    case 'back':
      navigateTo?.(-1);
      return true;
    case 'repeat':
      voice.repeat();
      return true;
    case 'speed': {
      const s = useSettings.getState();
      const rate = Math.round(Math.min(1.4, Math.max(0.4, s.speechRate + cmd.delta)) * 100) / 100;
      s.set({ speechRate: rate });
      void say(
        rate === s.speechRate
          ? `That's as ${cmd.delta < 0 ? 'slow' : 'fast'} as I go.`
          : `Okay, I'll talk ${cmd.delta < 0 ? 'slower' : 'faster'}. How's this?`,
      );
      return true;
    }
    case 'quiet':
      voice.stop();
      return true;
    case 'help':
      return `${APP_HELP} What would you like to do?`;
    case 'hello':
      return "Hi, I'm here. What would you like to do?";
    case 'thanks':
      void say("You're welcome.");
      return true;
    default:
      return `Sorry, I didn't understand ${heard}. ${APP_HELP}`;
  }
}

/** Hand one utterance to the screen, then to the app. */
export function handleUtterance(heard: string): Reply {
  if (!heard) return "Sorry, I didn't catch that. What would you like to do?";
  const screen = screens.at(-1);
  const r = screen?.handle(heard);
  if (r !== undefined && r !== false) return r;
  return runAppCommand(heard);
}

const FOLLOW_UPS = 2;
let busy = false;

/**
 * Listen and act, as a conversation: ask `prompt` (or just listen once the app has finished
 * talking, if empty), handle the answer, and keep asking any follow-up question.
 */
export async function talk(prompt = ''): Promise<void> {
  if (busy) return;
  busy = true;
  useAssistant.setState({ listening: true });
  try {
    let question = prompt;
    let misses = 0;
    for (;;) {
      const hints = screens.at(-1)?.hints ?? [];
      const heard = await ask(question, [...hints, 'go back', 'look around', 'take me to']);
      if (heard) lastSpokeAt = Date.now();
      const reply = handleUtterance(heard);
      if (typeof reply !== 'string') break;
      // Two misses in a row: stop asking and leave the mic closed.
      misses = heard && !reply.startsWith('Sorry') ? 0 : misses + 1;
      if (misses > FOLLOW_UPS) {
        void say("I'll be here. Press Talk when you need me.");
        break;
      }
      question = reply;
    }
  } catch {
    void say('Listening is not available right now. You can use the buttons instead.');
  } finally {
    busy = false;
    useAssistant.setState({ listening: false });
  }
}

/** Keep talking only if the person is already talking with the app by voice. */
export function continueConversation(prompt = '') {
  if (inConversation()) void talk(prompt);
}

/** Start a conversation without a press (e.g. the first time the app opens). */
export function startConversation(prompt: string) {
  lastSpokeAt = Date.now();
  void talk(prompt);
}
