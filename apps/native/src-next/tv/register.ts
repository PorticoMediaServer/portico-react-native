/** The TV entry shares the genuine restore/session lifetime and single player.
 * Screen-owned registration modules are imported at this platform entry. */
import '../screens/home/CustomizeRoute';
import '../screens/home/SeeAllRoute';
import '../screens/settings-live/LiveRoute';
import '../screens/settings-live/TogetherRoute';
export {RestoredShell as TVRoot} from '../shell/RestoredShell';
export {TVCredentialForm, TVCodePresenter, TVVerificationForm, TVProfilePINForm, TVRequiredSetupHandoff, TVManagementHandoff} from './auth';
