/**
 * Bottom sheet that asks how long a shared link should live, and then makes it.
 *
 * Choosing IS sharing: there is no confirm button, so this costs one tap over
 * the old behaviour of creating the link straight away. The last choice comes
 * back marked the next time, because people who share tend to share the same
 * way twice.
 *
 * Mounted once in the root layout; opened from anywhere with
 * `useSharePicker.getState().open(...)`.
 */
import Icon from '@/components/Icon';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
} from 'react-native';

import { SheetModal } from '@/components/SheetModal';
import { useAccent } from '@/hooks/useAccent';
import { useT } from '@/i18n';
import { canShareDownloads, shareItem } from '@/lib/share';
import { useSettings, SHARE_EXPIRIES, type ShareExpiry } from '@/store/settings';
import { useSharePicker } from '@/store/sharePicker';
import { useToast } from '@/store/toast';
import { colors, fontSize, spacing, themed } from '@/theme';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * "Never", as a date. There is no value that means no expiry: leaving it out,
 * a zero and a negative all read as "use your default" on the other side, so
 * the only honest way to say never is to say a date nobody will be around for.
 */
const NEVER = Date.UTC(2100, 0, 1);

/**
 * When a link made now should stop working. A month is 30 days: nobody sharing
 * an album means "the 31st at this exact time", and the exact date is there for
 * whoever does.
 */
function expiryAt(kind: ShareExpiry): number {
  const spans: Record<Exclude<ShareExpiry, 'never'>, number> = {
    hour: HOUR,
    day: DAY,
    week: 7 * DAY,
    month: 30 * DAY,
  };
  return kind === 'never' ? NEVER : Date.now() + spans[kind];
}

/** Global instance: mounted once, opens from the store. */
export function GlobalShareSheet() {
  const target = useSharePicker((s) => s.target);
  const closeNow = useSharePicker((s) => s.close);
  const t = useT();
  // From the store, not `colors.accent`: the sheet has to re-render for the
  // switch and the tick to follow a change of accent.
  const accent = useAccent();
  const toast = useToast((s) => s.show);
  const lastUsed = useSettings((s) => s.shareExpiry);
  const setLastUsed = useSettings((s) => s.setShareExpiry);
  const downloads = useSettings((s) => s.shareDownloadable);
  const setDownloads = useSettings((s) => s.setShareDownloadable);
  // Only Navidrome can be told this, and only through its own API. Elsewhere
  // the row isn't there rather than being there and doing nothing.
  const canDownloads = canShareDownloads();
  /** The calendar is open (Android shows it as its own dialog). */
  const [pickingDate, setPickingDate] = useState(false);
  /** Waiting for the server to mint the link. */
  const [sharing, setSharing] = useState(false);

  // Nothing to share, nothing to draw: the sheet stands in front of the frame
  // for the same reason its screens do, and that is what narrows `target` below.
  if (!target) return null;

  const labels: Record<ShareExpiry, string> = {
    hour: t('1 hour'),
    day: t('1 day'),
    week: t('1 week'),
    month: t('1 month'),
    // "Never" here is a link that does not expire, and elsewhere it is a plain
    // no ("play downloaded songs: never"). Some languages want a different word
    // for each, and with one key the two uses had to share whichever came last:
    // Russian went from «Бессрочно» to «Никогда» for that reason. The context
    // suffix is optional, so a language that is happy with one word still only
    // defines "Never".
    never: t('Never::expiry'),
  };

  /** The calendar's answer: a date, or nothing if it was dismissed.
   *  `close` is the shared frame's, threaded to here: the calendar answers from
   *  a callback of its own, so it cannot see the one the render hands content. */
  function onDatePicked(event: DateTimePickerEvent, date: Date | undefined, close: (after?: () => void) => void) {
    setPickingDate(false);
    if (event.type !== 'set' || !date) return;
    // End of the chosen day: picking "the 5th" means the link works through
    // the 5th, not until midnight opening it.
    date.setHours(23, 59, 59, 999);
    void share(date.getTime(), close);
  }

  /**
   * Tomorrow as the starting point, and nothing before the next hour: a link
   * that expired before it was made is not something to let anyone pick.
   *
   * On Android the calendar is opened imperatively, as its own dialog: as a
   * component it would be rendered inside this sheet's Modal, which is the way
   * to have a native dialog come up behind it.
   */
  function pickDate(close: (after?: () => void) => void) {
    if (Platform.OS !== 'android') {
      setPickingDate(true);
      return;
    }
    DateTimePickerAndroid.open({
      value: new Date(Date.now() + DAY),
      minimumDate: new Date(Date.now() + HOUR),
      mode: 'date',
      onChange: (event, value) => onDatePicked(event, value, close),
    });
  }

  /** Creates the link with this expiry and hands it to the system sheet. */
  async function share(expiresAt: number, close: (after?: () => void) => void) {
    if (!target || sharing) return;
    setSharing(true);
    const res = await shareItem(target.id, target.name, expiresAt, canDownloads && downloads);
    setSharing(false);
    close();
    if (!res.ok) toast(t("Couldn't create the link"));
    // The link is out and it plays; it is only the downloading part that didn't
    // take, and saying nothing would leave whoever gets it wondering.
    else if (res.downloadsFailed) toast(t("Server didn't allow downloads"));
  }

  return (
    <SheetModal
      visible={!!target}
      onClosed={closeNow}
      /* The calendar outside Android belongs to the Modal and sits over the
         sheet, which stays open behind it: inside the sheet it would slide with
         it and come up behind it, the same reason Android opens it on its own. */
      overSheet={(close) =>
        pickingDate ? (
          <DateTimePicker
            value={new Date(Date.now() + DAY)}
            mode="date"
            minimumDate={new Date(Date.now() + HOUR)}
            onChange={(event, value) => onDatePicked(event, value, close)}
          />
        ) : null
      }
    >
      {(close) => (
        <>
          <Text style={styles.title} numberOfLines={1}>
            {target.name ? t('Share “{name}”', { name: target.name }) : t('Share')}
          </Text>
          <Text style={styles.subtitle}>{t('The link expires in')}</Text>
          <View style={styles.divider} />
          {sharing ? (
            <ActivityIndicator style={{ marginVertical: spacing.xl }} color={accent} />
          ) : (
            <>
              {SHARE_EXPIRIES.map((kind) => (
                <Pressable
                  key={kind}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  onPress={() => {
                    setLastUsed(kind);
                    void share(expiryAt(kind), close);
                  }}
                >
                  <Text style={styles.rowText}>{labels[kind]}</Text>
                  {/* The last one used, so sharing the same way twice is a
                        matter of tapping where the tick already is. */}
                  {kind === lastUsed ? (
                    <Icon name="checkmark" size={20} color={accent} />
                  ) : null}
                </Pressable>
              ))}
              <Pressable
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                onPress={() => pickDate(close)}
              >
                <Text style={styles.rowText}>{t('Pick a date…')}</Text>
                <Icon name="calendar-outline" size={20} color={colors.textSecondary} />
              </Pressable>
              {/* Below the line because it is not one of the answers: it does
                    not share, it decides what the link will allow. */}
              {canDownloads ? (
                <>
                  <View style={styles.divider} />
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: downloads }}
                    onPress={() => setDownloads(!downloads)}
                  >
                    <Text style={styles.rowText}>{t('Allow downloads')}</Text>
                    <Switch
                      value={downloads}
                      onValueChange={setDownloads}
                      trackColor={{ false: colors.control, true: accent }}
                      thumbColor={colors.knob}
                    />
                  </Pressable>
                </>
              ) : null}
            </>
          )}
        </>
      )}
    </SheetModal>
  );
}

const styles = themed((colors) => ({
  // The sheet's frame (backdrop, sheet, grabber) is not re-declared here: it
  // takes the shared one (see `SheetModal`).
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: { color: colors.text, fontSize: fontSize.md },
}));
