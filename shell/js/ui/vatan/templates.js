import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SOURCE_DIR = '/usr/share/vatan/templates';
// Şablon seti değiştiğinde artırılır; yalnızca yeni sürüm bir kez daha kopyalanır.
const TEMPLATES_VERSION = 1;

// Masaüstündeki ve Dosyalar'daki "Yeni Belge" menüsü kullanıcının Şablonlar
// klasöründen beslenir; Pardus bu klasörü boş getirir. Şablonlar sürüm başına
// bir kez konur: kullanıcının sildiği geri gelmez, aynı adlı dosyasına dokunulmaz.
export function installTemplates() {
    const settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
    if (settings.get_int('templates-version') >= TEMPLATES_VERSION)
        return;

    const target = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_TEMPLATES);
    // Şablon dizini tanımlı değilse GLib ev dizinini döndürür; oraya dosya saçılmaz.
    if (!target || target === GLib.get_home_dir()) {
        console.warn('VATAN şablonlar: Şablonlar klasörü tanımlı değil');
        return;
    }

    try {
        const targetDir = Gio.File.new_for_path(target);
        try {
            targetDir.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }

        const children = Gio.File.new_for_path(SOURCE_DIR)
            .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        for (let info; (info = children.next_file(null));) {
            const source = children.get_child(info);
            try {
                source.copy(targetDir.get_child(info.get_name()), Gio.FileCopyFlags.NONE, null, null);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    throw e;
            }
        }
        settings.set_int('templates-version', TEMPLATES_VERSION);
    } catch (e) {
        console.error(`VATAN şablonlar: ${e.message}`);
    }
}
