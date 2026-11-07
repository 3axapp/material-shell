/** Gnome libs imports */
import Shell from 'gi://Shell';
import { assertNotNull } from 'src/utils/assert';

export class AppsManager {
    static getApps() {
        const usage = Shell.AppUsage.get_default();
        const appSystem = Shell.AppSystem.get_default();
        const appsInstalled = appSystem.get_installed().filter((appInfo) => {
            try {
                const _ = appInfo.get_id(); // catch invalid file encodings
            } catch (_e) {
                return false;
            }
            return appInfo.should_show();
        });

        return appsInstalled
            .sort((a, b) => {
                return usage.compare(
                    assertNotNull(a.get_id()),
                    assertNotNull(b.get_id())
                );
            })
            .map((appInfo) => {
                return appSystem.lookup_app(assertNotNull(appInfo.get_id()));
            });
    }
}
