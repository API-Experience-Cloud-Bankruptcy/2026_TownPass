import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp, type FontLevel } from '@/lib/app-state';
import { go, goBack } from '@/lib/nav';
import { inTownPass } from '@/lib/townpass';

export const MAX_WIDTH = 640;
export const TOUCH = 52;

const SIZES = { display: 28, title: 23, heading: 20, body: 18, small: 16 } as const;
type Size = keyof typeof SIZES;

export function T({
  size = 'body',
  weight,
  muted,
  color,
  style,
  children,
  heading,
  ...rest
}: {
  size?: Size;
  weight?: '400' | '600' | '700';
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  heading?: 1 | 2 | 3;
  role?: 'status';
  selectable?: boolean;
  numberOfLines?: number;
}) {
  const { scale, colors } = useApp();
  const fontSize = Math.round(SIZES[size] * scale);
  return (
    <Text
      {...rest}
      role={heading ? 'heading' : rest.role}
      aria-level={heading}
      style={[
        {
          fontSize,
          lineHeight: Math.round(fontSize * 1.5),
          color: color ?? (muted ? colors.muted : colors.text),
          fontWeight: weight ?? (heading ? '700' : '400'),
          fontFamily: FONT,
        },
        style,
      ]}>
      {children}
    </Text>
  );
}

const FONT =
  "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'Heiti TC', system-ui, -apple-system, sans-serif";

export function Btn({
  label,
  onPress,
  variant = 'secondary',
  hint,
  style,
  selected,
  role = 'button',
  disabled,
  icon,
  align = 'center',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  hint?: string;
  style?: StyleProp<ViewStyle>;
  selected?: boolean;
  role?: 'button' | 'link' | 'checkbox' | 'radio';
  disabled?: boolean;
  icon?: string;
  align?: 'center' | 'left';
}) {
  const { colors } = useApp();
  const active = variant === 'primary' || selected;
  const fg = active ? colors.accentText : variant === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      role={role}
      aria-label={label}
      aria-checked={role === 'checkbox' || role === 'radio' ? !!selected : undefined}
      aria-disabled={disabled}
      accessibilityHint={hint}
      style={({ pressed, focused }: { pressed: boolean; focused?: boolean }) => [
        styles.btn,
        {
          backgroundColor: active ? colors.accent : variant === 'ghost' ? 'transparent' : colors.surface,
          borderColor: active ? colors.accent : variant === 'ghost' ? 'transparent' : colors.border,
          justifyContent: align === 'left' ? 'flex-start' : 'center',
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        focused && { outlineColor: colors.focus, outlineWidth: 3, outlineStyle: 'solid', outlineOffset: 2 },
        style,
      ]}>
      {icon ? (
        <T weight="700" color={fg} style={styles.btnIcon}>
          {icon}
        </T>
      ) : null}
      <T weight="600" color={fg} style={align === 'left' ? styles.leftText : styles.centerText}>
        {label}
      </T>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, highContrast } = useApp();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: highContrast ? 2 : 1 },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Screen({
  title,
  children,
  back = true,
  hideHelp,
  footerAction,
}: {
  title: string;
  children: ReactNode;
  back?: boolean;
  hideHelp?: boolean;
  /** Pinned action shown above the help bar, e.g. 下一步. */
  footerAction?: ReactNode;
}) {
  const { colors, loaded } = useApp();
  const insets = useSafeAreaInsets();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Town Pass shows the service name in its own top bar. Read after mount so the static HTML matches the first render.
  const [hostBar, setHostBar] = useState(false);
  useEffect(() => setHostBar(inTownPass()), []);
  if (!loaded) {
    // Answers are restored after mount; showing the page before that flashes wrong results.
    return (
      <View style={[styles.root, styles.loading, { backgroundColor: colors.bg }]} role="status" aria-label="載入中">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View
        nativeID="app-header"
        style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: colors.bg, borderColor: colors.border }]}>
        <View style={styles.headerInner}>
          {back ? (
            <Pressable
              role="button"
              aria-label="回上一頁"
              onPress={goBack}
              style={styles.headerBtn}>
              <T weight="600" color={colors.accent}>
                ‹ 返回
              </T>
            </Pressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
          {hostBar ? (
            <View style={styles.headerTitle} />
          ) : (
            <T size="small" weight="600" muted style={styles.headerTitle} numberOfLines={1}>
              {title}
            </T>
          )}
          <Pressable
            role="button"
            aria-label="調整字級與對比"
            onPress={() => setSettingsOpen(true)}
            style={[styles.headerBtn, styles.headerBtnRight]}>
            <T weight="700" color={colors.accent}>
              字級
            </T>
          </Pressable>
        </View>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.column}>
          {children}
          <T size="small" muted style={styles.disclaimer}>
            本服務為黑客松原型，資料以各機關公告為準
          </T>
        </View>
      </ScrollView>
      {footerAction ? (
        <View style={[styles.pinned, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={styles.columnFlat}>{footerAction}</View>
        </View>
      ) : null}
      {hideHelp ? null : <HelpBar bottomInset={insets.bottom} />}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}

function HelpBar({ bottomInset }: { bottomInset: number }) {
  const { colors } = useApp();
  return (
    <View
      nativeID="help-bar"
      style={[styles.helpBar, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: bottomInset + 8 }]}>
      <View style={styles.columnFlat}>
        <Btn label="請人幫我" variant="primary" onPress={() => go('/help')} />
      </View>
    </View>
  );
}

const LEVELS: { id: FontLevel; label: string }[] = [
  { id: 'standard', label: '標準' },
  { id: 'large', label: '大' },
  { id: 'xlarge', label: '特大' },
];

function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors, fontLevel, setFontLevel, highContrast, setHighContrast } = useApp();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} aria-label="關閉">
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => {}}
          role="dialog"
          aria-label="字級與對比">
          <T size="title" heading={2}>
            字級與對比
          </T>
          <T weight="600" style={styles.sheetLabel}>
            字級
          </T>
          <View style={styles.row} role="radiogroup">
            {LEVELS.map((l) => (
              <Btn
                key={l.id}
                label={l.label}
                role="radio"
                selected={fontLevel === l.id}
                onPress={() => setFontLevel(l.id)}
                style={styles.flex1}
              />
            ))}
          </View>
          <T weight="600" style={styles.sheetLabel}>
            對比
          </T>
          <View style={styles.row} role="radiogroup">
            <Btn label="一般" role="radio" selected={!highContrast} onPress={() => setHighContrast(false)} style={styles.flex1} />
            <Btn label="高對比" role="radio" selected={highContrast} onPress={() => setHighContrast(true)} style={styles.flex1} />
          </View>
          <Btn label="完成" variant="primary" onPress={onClose} style={styles.sheetDone} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function Dots({ total, current }: { total: number; current: number }) {
  const { colors } = useApp();
  return (
    <View style={styles.dots} role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current + 1} aria-label={`第 ${current + 1} 題，共 ${total} 題`}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { backgroundColor: i <= current ? colors.accent : colors.border, width: i === current ? 24 : 10 },
          ]}
        />
      ))}
    </View>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <T size="heading" heading={2} style={styles.flex1}>
          {title}
        </T>
        {aside}
      </View>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, minHeight: '100%' as unknown as number },
  loading: { alignItems: 'center', justifyContent: 'center' },
  /** Buttons sharing a row: sized by their label and wrapped onto their own line when the text no longer fits. */
  rowBtn: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  header: { borderBottomWidth: 0, paddingHorizontal: 8, paddingBottom: 4 },
  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: MAX_WIDTH + 16,
    alignSelf: 'center',
  },
  headerBtn: { minHeight: 48, minWidth: 72, justifyContent: 'center', paddingHorizontal: 8 },
  headerBtnRight: { alignItems: 'flex-end' },
  headerSpacer: { minWidth: 72 },
  headerTitle: { flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24 },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: 16 },
  columnFlat: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  disclaimer: { textAlign: 'center', marginTop: 24 },
  btn: {
    minHeight: TOUCH,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  btnIcon: { width: 24, textAlign: 'center' },
  centerText: { textAlign: 'center', flexShrink: 1 },
  leftText: { flex: 1 },
  card: { borderRadius: 16, padding: 16, gap: 10 },
  pinned: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1 },
  helpBar: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 28,
    gap: 10,
  },
  sheetLabel: { marginTop: 6 },
  sheetDone: { marginTop: 12 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  flex1: { flex: 1 },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { height: 10, borderRadius: 5 },
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
