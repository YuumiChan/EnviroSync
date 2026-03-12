// RMS-to-Magnitude lookup table
const rmsToMagTable = [
	[0.003, 1.1],
	[0.01, 2.1],
	[0.03, 3.2],
	[0.1, 4.4],
	[0.3, 5.5],
	[0.7, 6.4],
];

export function rmsToMagnitude(rms) {
	if (rms <= 0) return 0;
	const logRms = Math.log10(rms);
	const logTable = rmsToMagTable.map(([r, m]) => [Math.log10(r), m]);

	if (logRms <= logTable[0][0]) return logTable[0][1];
	if (logRms >= logTable[logTable.length - 1][0]) return logTable[logTable.length - 1][1];

	for (let i = 0; i < logTable.length - 1; i++) {
		if (logRms >= logTable[i][0] && logRms <= logTable[i + 1][0]) {
			const fraction = (logRms - logTable[i][0]) / (logTable[i + 1][0] - logTable[i][0]);
			return logTable[i][1] + fraction * (logTable[i + 1][1] - logTable[i][1]);
		}
	}
	return 0;
}

export function magnitudeToRms(mag) {
	const logTable = rmsToMagTable.map(([r, m]) => [Math.log10(r), m]);

	if (mag <= logTable[0][1]) return rmsToMagTable[0][0];
	if (mag >= logTable[logTable.length - 1][1]) return rmsToMagTable[rmsToMagTable.length - 1][0];

	for (let i = 0; i < logTable.length - 1; i++) {
		if (mag >= logTable[i][1] && mag <= logTable[i + 1][1]) {
			const fraction = (mag - logTable[i][1]) / (logTable[i + 1][1] - logTable[i][1]);
			const logRms = logTable[i][0] + fraction * (logTable[i + 1][0] - logTable[i][0]);
			return Math.pow(10, logRms);
		}
	}
	return 0;
}

export { rmsToMagTable };
