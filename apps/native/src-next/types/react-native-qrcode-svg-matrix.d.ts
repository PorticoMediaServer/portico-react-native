// The QR module matrix react-native-qrcode-svg draws from (its own dependency, qrcode).
declare module 'react-native-qrcode-svg/src/genMatrix' {
  export default function genMatrix(value: string, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): number[][];
}
