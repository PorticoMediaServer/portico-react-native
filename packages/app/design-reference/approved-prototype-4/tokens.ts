import type {TextStyle, ViewStyle} from 'react-native';

export const color = {
  projector: '#070B10',
  recess: '#0A1017',
  slate: '#101820',
  raisedSlate: '#151F29',
  brightSlate: '#1A2632',
  screenBlue: '#63B8F4',
  screenBlueStrong: '#87CCFF',
  screenBlueDeep: '#1D76AF',
  silver: '#F4F7FA',
  softSilver: '#C7D0D8',
  dimSilver: '#8F9BA6',
  mutedSilver: '#687581',
  tunerAmber: '#D7A34D',
  healthy: '#62C9A7',
  record: '#ED5B67',
  line: 'rgba(197, 218, 235, 0.14)',
  lineSoft: 'rgba(197, 218, 235, 0.08)',
  lineStrong: 'rgba(147, 205, 245, 0.32)',
  focus: '#EAF6FF',
  scrim: 'rgba(7, 11, 16, 0.84)',
  scrimStrong: 'rgba(7, 11, 16, 0.96)',
  transparent: 'rgba(0,0,0,0)',
} as const;

export const radius = {
  artwork: 8,
  control: 8,
  surface: 10,
  overlay: 14,
  round: 999,
} as const;

export const font = {
  regular: 'Manrope-Regular',
  medium: 'Manrope-Medium',
  demi: 'Manrope-SemiBold',
  bold: 'Manrope-Bold',
} as const;

export const mobileType = {
  hero: {fontFamily: font.bold, fontSize: 48, letterSpacing: -1.8, lineHeight: 50} as TextStyle,
  title: {fontFamily: font.bold, fontSize: 30, letterSpacing: -0.8, lineHeight: 36} as TextStyle,
  section: {fontFamily: font.demi, fontSize: 22, letterSpacing: -0.35, lineHeight: 27} as TextStyle,
  card: {fontFamily: font.demi, fontSize: 15, lineHeight: 19} as TextStyle,
  body: {fontFamily: font.regular, fontSize: 16, lineHeight: 23} as TextStyle,
  supporting: {fontFamily: font.regular, fontSize: 14, lineHeight: 19} as TextStyle,
  caption: {fontFamily: font.medium, fontSize: 12, lineHeight: 16} as TextStyle,
  nav: {fontFamily: font.medium, fontSize: 11, lineHeight: 14} as TextStyle,
} as const;

export const tvType = {
  hero: {fontFamily: font.bold, fontSize: 72, letterSpacing: -2.4, lineHeight: 76} as TextStyle,
  title: {fontFamily: font.bold, fontSize: 48, letterSpacing: -1.4, lineHeight: 56} as TextStyle,
  section: {fontFamily: font.demi, fontSize: 30, letterSpacing: -0.55, lineHeight: 36} as TextStyle,
  card: {fontFamily: font.demi, fontSize: 22, lineHeight: 27} as TextStyle,
  body: {fontFamily: font.regular, fontSize: 24, lineHeight: 34} as TextStyle,
  supporting: {fontFamily: font.regular, fontSize: 20, lineHeight: 28} as TextStyle,
  caption: {fontFamily: font.medium, fontSize: 17, lineHeight: 22} as TextStyle,
  rail: {fontFamily: font.demi, fontSize: 22, lineHeight: 28} as TextStyle,
} as const;

export const fill: ViewStyle = {bottom: 0, left: 0, position: 'absolute', right: 0, top: 0};
