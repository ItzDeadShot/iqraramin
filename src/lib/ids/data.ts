import featureSchema from '../../content/data/ids/feature-schema.json';
import scalerJson from '../../content/data/ids/scaler.json';
import modelJson from '../../content/data/ids/model.json';
import samplesJson from '../../content/data/ids/samples.json';
import type { FeatureSpec, ModelParams, SampleFlow, ScalerParams } from './detector';

export const DATASET_LICENSE: string = featureSchema.license;
export const FEATURES: FeatureSpec[] = featureSchema.features as FeatureSpec[];
export const SCALER: ScalerParams = scalerJson as ScalerParams;
export const MODEL: ModelParams = modelJson as ModelParams;
export const SAMPLES: SampleFlow[] = samplesJson.samples as SampleFlow[];
