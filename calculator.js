let landmarks = {};
let maxDistanceMultiplier = 3;
let measurements = {};
let debug = true; // triangulation debugging



function setMeasurement(measurement) {
	measurements[measurement.id] = measurement;
	
	// scrub the islands map
	landmarks = {};
	console.log(calculateIslands());
	
}

/**
 * Construct the island list entirely from the bearing data
 */
function calculateIslands() {
	let firstIsland = null;
	let secondIsland = null;
	let firstIslands = {}; // use this to calculate the first two islands

	// construct initial data from measurements data

	Object.values(measurements).forEach(measurement => {
		landmarks[measurement.from] = landmarks[measurement.from] || {name: measurement.from};
		let fromIsland = landmarks[measurement.from];
		fromIsland.visited = true; // if you measured from this island then you were there!

		if (firstIsland === null && firstIslands[measurement.from] !== undefined) {
			firstIsland = landmarks[firstIslands[measurement.from].from];
			secondIsland = fromIsland;
		}

		if (measurement.to !== "") { // the destination has been named
			// initialise known targets array
			firstIslands[measurement.to] = measurement;

			fromIsland.knownTargets = fromIsland.knownTargets || {};

			// add the current record
			fromIsland.knownTargets[measurement.to] = {
				name: measurement.to
				,bearing: measurement.bearing
			};

			landmarks[measurement.to] = landmarks[measurement.to] || {name: measurement.to};
		} else { // unnamed islands are just treated as bearings at this point
			fromIsland.unknownTargets = fromIsland.unknownTargets || [];
			fromIsland.unknownTargets.push({"bearing": measurement.bearing});
		}

	});

	// start calculating island locations given the starting island
	if (firstIsland) locateIsland(firstIsland, 0,0); // place the first island on origin immediately
	if (secondIsland) {
		let bearing = firstIsland.knownTargets[secondIsland.name].bearing * Math.PI / 180;
		locateIsland(
			secondIsland, Math.sin(bearing)
			,Math.cos(bearing)
		); // create the second island 1 unit away at specified angle
	}
	//updateChart();

	return landmarks;
}

/**
 * Update chart axes to neatly contain the map
 */
function updateChart() {
	// update chart boundaries
	let boundaries = {
		xMin: 0, xMax: 0, yMin: 0, yMax: 0
	}

	Object.values(landmarks).filter(island => island.located).forEach(island =>
			boundaries = {
				xMin: Math.min(boundaries.xMin, Math.round(island.x-1))
				,xMax: Math.max(boundaries.xMax, Math.round(island.x + 1))
				,yMin: Math.min(boundaries.yMin, Math.round(island.y -1))
				,yMax: Math.max(boundaries.yMax, Math.round(island.y + 1))
			}
		);

	let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Bearings");
	let chart = sheet.getCharts()[0];

	chart = chart.modify()
		.setOption("hAxis", {minValue: boundaries.xMin, maxValue: boundaries.xMax, gridlines: {count: 0}})
		.setOption("vAxis", {minValue: boundaries.yMin, maxValue: boundaries.yMax, gridlines: {count: 0}})
		.setOption("chartArea", {backgroundColor:"#transparent"})
		.setOption("colors", ['silver', 'green'])
		.build()
	;
	sheet.updateChart(chart);
}

/**
 * An island has been located. Analyse it alongside the other located islands to try find more
 */
function locateIsland(island, x, y) {
	Object.assign(island, {x:x, y:y, located:true});
	let locatedQueue = [island];

	while (locatedQueue.length > 0) {
		let island = locatedQueue.shift();
		console.log(`${island.name} located @ [${island.x.toFixed(1)}, ${island.y.toFixed(1)}]`);

		Object.values(landmarks)
			.filter(
				locatedIsland => locatedIsland.name !== island.name // it is not the same island
				&& locatedIsland.located === true // has been previously located
				&& inRange(island, locatedIsland) // within appropriate comparison range
			)
			.forEach(locatedIsland => locatedQueue.push(...compareIsland(island, locatedIsland)));
	}
}

/**
 * Compare two located islands
 */
function compareIsland(island1, island2) {
	let locatedIslands = [];

	// compare known locations of both islands
	locatedIslands.push(...compareKnown(island1, island2));

	// compare island 1 known to island 2 unknown
	locatedIslands.push(...compareKnownUnknown(island1, island2));
	locatedIslands.push(...compareKnownUnknown(island2, island1)); // also need to do this in reverse

	return locatedIslands;
}

/**
 * Compare known locations for  two islands
 */
function compareKnown(island1, island2) {
	let locatedIslands = [];
	if (island1.knownTargets !== undefined && island2.knownTargets !== undefined) {
		Object.values(island1.knownTargets).forEach(knownTarget1 => {
			let locatedIsland = null;
			Object.values(island2.knownTargets).filter(knownTarget2 => knownTarget2.name == knownTarget1.name).forEach(knownTarget2 => {
				if (locatedIsland !== null) return; // no need to process since the target has been resolved
				let triangulation = triangulate(island1, knownTarget1.bearing, island2, knownTarget2.bearing);

				if (debug) {
					console.log(`Triangulating ${knownTarget1.name} from ${island1.name}(${knownTarget1.bearing}) and ${island2.name}(${knownTarget2.bearing})`);
					if (triangulation) {
						console.log(`Triangulated ${knownTarget1.name} x: ${triangulation.x}, y:${triangulation.y} from ${island1.name}(${knownTarget1.bearing}) and ${island2.name}(${knownTarget2.bearing})`);
					} else {
						console.log(`Unable to triangulate ${knownTarget1.name} from ${island1.name}(${knownTarget1.bearing}) and ${island2.name}(${knownTarget2.bearing})`);
					}
				}

				if (!landmarks[knownTarget1.name].located && inRange(island1, triangulation)) {
					let locatedIsland = Object.assign(
						landmarks[knownTarget1.name]
						,triangulation
						,{located: true}
					);
					locatedIslands.push(locatedIsland);
				}
			});
		});
	}
	return locatedIslands;
}

/**
 * Compare known targets for an island against unknown targets for the other island
 */
function compareKnownUnknown(knownIsland, unknownIsland) {
	let locatedIslands = [];
	if (knownIsland.knownTargets !== undefined && unknownIsland.unknownTargets !== undefined) {
		Object.values(knownIsland.knownTargets).forEach(knownTarget1 => {
			let locatedIsland = null;
			Object.values(unknownIsland.unknownTargets).forEach((unknownTarget, index) => {
				if (locatedIsland !== null) return; // no need to process since the target has been resolved
				let triangulation = triangulate(knownIsland, knownTarget1.bearing ,unknownIsland, unknownTarget.bearing);

				if (debug) {
					console.log(`Triangulating ${knownTarget1.name} from ${knownIsland.name}(${knownTarget1.bearing}) and ${unknownIsland.name}(${unknownTarget.bearing})`);
					if (triangulation) {
						console.log(`Triangulated ${knownTarget1.name} x: ${triangulation.x}, y:${triangulation.y} from ${knownIsland.name}(${knownTarget1.bearing}) and ${unknownIsland.name}(${unknownTarget.bearing})`);
					} else {
						console.log(`Unable to triangulate ${knownTarget1.name} from ${knownIsland.name}(${knownTarget1.bearing}) and ${unknownIsland.name}(${unknownTarget.bearing})`);
					}
				}

				if (!landmarks[knownTarget1.name].located && inRange(knownIsland, triangulation)) {
					let locatedIsland = Object.assign(landmarks[knownTarget1.name], triangulation, {located: true});
					locatedIslands.push(locatedIsland);

					unknownIsland.unknownTargets.splice(index, 1); // remove this entry from the unknown targets since it has been resolved
				}
			});
		});
	}
	return locatedIslands;
}

/**
 * Determine whether two islands co-ordinates are within an appropriate range
 */
function inRange(island1, island2) {
	if (
		!island1 || !island2 
		|| island1.x === null || island1.y === null || island2.x === null || island2.y === null
	) return false;
	let islandDistance = distance(island1.x, island1.y, island2.x, island2.y);
	return (islandDistance <= (maxDistanceMultiplier) && islandDistance > (0.2));
}

/**
 * Triangulates co-ordinate of position C given positions A and B with bearings 
 * https://www.thecivilengineer.org/education/professional-examinations-preparation/calculation-examples/calculation-example-find-the-coordinates-of-the-intersection-of-two-lines
 * @param {Object} a position A {x, y}
 * @param ac measured bearing to position C from position A (in degrees)
 * @param {Object} b position B {x, y}
 * @param bc measured bearing to position C from position B (in degrees)
 * @return co-ordinate of position C
 */
function triangulate(a, ac, b, bc) {
	//console.log(`${a.name}(${ac})->${b.name}(${bc}) : ${(ac - bc) % 180} `);
	if ((ac - bc) % 180 === 0) return null; // parallel lines
	if ((ac + 360) % 180 === 90) return triangulate(b, bc, a, ac);

	// tan 90/270 cannot be calculated but should be easy to resolve
	let bcHorizontal = (bc + 360) % 180 === 90; 

	// convert degrees to radians
	let acr = ac * (Math.PI / 180);
	let bcr = bc * (Math.PI / 180);

	let cy = b.y; // assume bc is horizontal initially

	if (!bcHorizontal) { // unless it is not
		cy = (b.x - a.x + a.y * Math.tan(acr) - b.y * Math.tan(bcr)) / (Math.tan(acr) - Math.tan(bcr));
	}

	let triangulation = {
		x: a.x + (cy - a.y) * Math.tan(acr)
		,y: cy
	}

	// determine that the triangulated bearings correspond with provided bearings (can be 180 deg out)
	if (Math.abs((bearingTo(a, triangulation) - ac) % 360) > 0.01) return null;
	if (Math.abs((bearingTo(b, triangulation) - bc) % 360) > 0.01) return null;

	return triangulation;
}

/**
 * Get the bearing to B from A in degrees
 * @param {Object} a position A
 * @param {Object} b position B
 * @returns {Number} bearing in degrees
 */
function bearingTo(a, b) {
	let bearing = Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI;
	return bearing;
}


/**
 * Distance between points A and B
 * @param {number} ax X co-ordinate of position A
 * @param {number} ay Y co-ordinate of position A
 * @param {number} bx X co-ordinate of position B
 * @param {number} by Y co-ordinate of position B
 * @return distance between points A and B
 * @customfunction
 */
function distance(ax, ay, bx, by) {
	return Math.sqrt(Math.pow(bx-ax,2) + Math.pow(by-ay,2));
}
