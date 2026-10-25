import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';

/** One bounded shortcut intent into the real Customize Home route. The route
 * takes it once; an absent intent leaves ordinary Customize Home untouched. */
let pending: PersonalResource | undefined;

export function askHomeCustomizeView(view: PersonalResource): void {pending = view;}

export function takeHomeCustomizeView(): PersonalResource | undefined {
  const view = pending; pending = undefined; return view;
}
