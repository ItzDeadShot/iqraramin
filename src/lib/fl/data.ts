import trainingPool from '../../content/data/ids/training-pool.json';
import testSet from '../../content/data/ids/test-set.json';
import clients from '../../content/data/ids/clients.json';
import { FEATURES, SCALER } from '../ids/data';
import { prepareDataset, type Dataset } from './sim';

export function loadDataset(): Dataset {
	return prepareDataset(trainingPool, testSet, clients, FEATURES, SCALER);
}
