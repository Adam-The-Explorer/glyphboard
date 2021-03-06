export class FeatureFilter {

  private _featureName: string;
  private _minValue: number;
  private _maxValue: number;

  constructor();
  constructor(featureName?: string);
  constructor(featureName?: string, minValue?: number, maxValue?: number) {
    this._featureName = featureName === undefined ? "" : featureName;
    this._minValue = minValue === undefined ? 0 : minValue;
    this._maxValue = maxValue === undefined ? 0 : maxValue;
  }

  public itemConfirmsToFilter(id: number, item: any, values?: any): boolean {
    const value: number = +item[this._featureName];

    return value >= this._minValue && value <= this._maxValue;
  }

  public get featureName(): string { return this._featureName }
  public set featureName(newFeatureName: string) { this._featureName = newFeatureName }

  public get minValue(): number { return this._minValue }
  public set minValue(newMinValue: number) {
    if(newMinValue === undefined) throw new RangeError("value undefined in feature filter");
    if (newMinValue < 0.0 || newMinValue > 1.0) {
      throw new RangeError('supplied parameter must be in interval [0,1]');
    }

    this._minValue = newMinValue;
  }

  public get maxValue(): number | undefined { return this._maxValue }
  public set maxValue(newMaxValue: number | undefined) {
    if(newMaxValue === undefined) throw new RangeError("value undefined in feature filter");
    if (newMaxValue < 0.0 || newMaxValue > 1.0) {
      throw new RangeError('supplied parameter must be in interval [0,1]');
    }

    this._maxValue = newMaxValue;
  }
}
