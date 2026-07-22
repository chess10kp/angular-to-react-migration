interface Widget {
  label: string;
}

export function brokenSample(w: Widget) {
  return w.lable;
}
