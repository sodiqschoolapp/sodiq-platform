import type { ComponentProps, FunctionComponent } from 'react';
import ArrowDownwardSvg from '@material-symbols/svg-500/rounded/arrow_downward-fill.svg?react';
import ArrowUpwardSvg from '@material-symbols/svg-500/rounded/arrow_upward-fill.svg?react';
import AssignmentSvg from '@material-symbols/svg-500/rounded/assignment-fill.svg?react';
import BarChartSvg from '@material-symbols/svg-500/rounded/bar_chart-fill.svg?react';
import CalendarMonthSvg from '@material-symbols/svg-500/rounded/calendar_month-fill.svg?react';
import ChevronLeftSvg from '@material-symbols/svg-500/rounded/chevron_left-fill.svg?react';
import DarkModeSvg from '@material-symbols/svg-500/rounded/dark_mode-fill.svg?react';
import ForumSvg from '@material-symbols/svg-500/rounded/forum-fill.svg?react';
import GridViewSvg from '@material-symbols/svg-500/rounded/grid_view-fill.svg?react';
import HistorySvg from '@material-symbols/svg-500/rounded/history-fill.svg?react';
import GroupSvg from '@material-symbols/svg-500/rounded/group-fill.svg?react';
import HomeSvg from '@material-symbols/svg-500/rounded/home-fill.svg?react';
import LightModeSvg from '@material-symbols/svg-500/rounded/light_mode-fill.svg?react';
import LogoutSvg from '@material-symbols/svg-500/rounded/logout-fill.svg?react';
import MenuBookSvg from '@material-symbols/svg-500/rounded/menu_book-fill.svg?react';
import MoreHorizSvg from '@material-symbols/svg-500/rounded/more_horiz-fill.svg?react';
import TuneSvg from '@material-symbols/svg-500/rounded/tune-fill.svg?react';
import CheckCircleSvg from '@material-symbols/svg-500/rounded/check_circle-fill.svg?react';
import CheckSvg from '@material-symbols/svg-500/rounded/check-fill.svg?react';
import ChevronRightSvg from '@material-symbols/svg-500/rounded/chevron_right-fill.svg?react';
import CloseSvg from '@material-symbols/svg-500/rounded/close-fill.svg?react';
import ContrastSvg from '@material-symbols/svg-500/rounded/contrast-fill.svg?react';
import DownloadSvg from '@material-symbols/svg-500/rounded/download-fill.svg?react';
// "expand_more" of the design system: the package names the same drawing keyboard_arrow_down.
import ExpandMoreSvg from '@material-symbols/svg-500/rounded/keyboard_arrow_down-fill.svg?react';
import FeedbackSvg from '@material-symbols/svg-500/rounded/feedback-fill.svg?react';
import InfoSvg from '@material-symbols/svg-500/rounded/info-fill.svg?react';
import LanguageSvg from '@material-symbols/svg-500/rounded/language-fill.svg?react';
import NotificationsSvg from '@material-symbols/svg-500/rounded/notifications-fill.svg?react';
import RadioButtonUncheckedSvg from '@material-symbols/svg-500/rounded/radio_button_unchecked-fill.svg?react';
import SearchSvg from '@material-symbols/svg-500/rounded/search-fill.svg?react';
import UnfoldMoreSvg from '@material-symbols/svg-500/rounded/unfold_more-fill.svg?react';
import ViewColumnSvg from '@material-symbols/svg-500/rounded/view_column-fill.svg?react';
import WarningSvg from '@material-symbols/svg-500/rounded/warning-fill.svg?react';

/** What an icon takes: the props of an `svg` without children. */
export type IconProps = Omit<ComponentProps<'svg'>, 'children'>;

/**
 * docs/design-system.md, Icons: Material Symbols Rounded, filled, weight 500,
 * one set only, drawn from SVG and never from a font ligature. Every icon of
 * the app is one of the components below; no other file imports an icon file
 * (tooling/design-parts.test.ts). Drawn in the colour of the text around it, 20
 * px unless the part around it or a `size-*` class says otherwise. An icon
 * without an `aria-label` is decoration, hidden from screen readers; with one
 * it is an image with that name.
 */
function icon(Svg: FunctionComponent<ComponentProps<'svg'>>) {
  return function Icon(props: IconProps) {
    const named = props['aria-label'] !== undefined;
    return (
      <Svg
        data-icon=""
        fill="currentColor"
        focusable="false"
        {...(named ? { role: 'img' } : { 'aria-hidden': true })}
        {...props}
      />
    );
  };
}

export const ArrowDownwardIcon = icon(ArrowDownwardSvg);
export const ArrowUpwardIcon = icon(ArrowUpwardSvg);
export const AssignmentIcon = icon(AssignmentSvg);
export const BarChartIcon = icon(BarChartSvg);
export const CalendarMonthIcon = icon(CalendarMonthSvg);
export const ChevronLeftIcon = icon(ChevronLeftSvg);
export const DarkModeIcon = icon(DarkModeSvg);
export const ForumIcon = icon(ForumSvg);
export const GridViewIcon = icon(GridViewSvg);
export const GroupIcon = icon(GroupSvg);
export const HistoryIcon = icon(HistorySvg);
export const HomeIcon = icon(HomeSvg);
export const LightModeIcon = icon(LightModeSvg);
export const LogoutIcon = icon(LogoutSvg);
export const MenuBookIcon = icon(MenuBookSvg);
export const MoreHorizIcon = icon(MoreHorizSvg);
export const TuneIcon = icon(TuneSvg);
export const CheckCircleIcon = icon(CheckCircleSvg);
export const CheckIcon = icon(CheckSvg);
export const ChevronRightIcon = icon(ChevronRightSvg);
export const CloseIcon = icon(CloseSvg);
export const ContrastIcon = icon(ContrastSvg);
export const DownloadIcon = icon(DownloadSvg);
export const ExpandMoreIcon = icon(ExpandMoreSvg);
export const FeedbackIcon = icon(FeedbackSvg);
export const InfoIcon = icon(InfoSvg);
export const LanguageIcon = icon(LanguageSvg);
export const NotificationsIcon = icon(NotificationsSvg);
export const RadioButtonUncheckedIcon = icon(RadioButtonUncheckedSvg);
export const SearchIcon = icon(SearchSvg);
export const UnfoldMoreIcon = icon(UnfoldMoreSvg);
export const ViewColumnIcon = icon(ViewColumnSvg);
export const WarningIcon = icon(WarningSvg);
