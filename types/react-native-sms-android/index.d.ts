declare namespace SmsAndroid {
  const sms: (
    number: string,
    message: string,
    sendOption: 'sendDirect' | 'sendIndirect',
    callback: (err: Error, message: string) => void,
  ) => void;
}

export = SmsAndroid;
