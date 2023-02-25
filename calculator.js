let landmarks = {};
let maxDistanceMultiplier = 3;
let measurements = {};
let debug = true; // triangulation debugging


function addMeasurement() {
	let id = 1;
	Object.values(measurements).forEach(measurement => id = Math.max(id, measurement.id + 1));
	setMeasurement({
		id: id
		,from: document.addMeasurement.from.value
		,bearing: parseInt(document.addMeasurement.bearing.value)
		,to: document.addMeasurement.to.value
	});

	// erase form
	document.addMeasurement.bearing.value = "";
	document.addMeasurement.to.value = "";
	setVariable(document.addMeasurement.bearing);
	document.addMeasurement.bearing.focus();
	$("#fromList")[0].innerHTML = "";
	Object.values(landmarks).forEach(landmark=>{
		let newOption = $("#landmark")[0].content.cloneNode(true);
		newOption.querySelector("option").value = landmark.name;
		$("#fromList")[0].appendChild(newOption);
	});
}

function setMeasurement(measurement) {
	measurements[measurement.id] = measurement;
	
	// scrub the landmarks map
	landmarks = {};
	console.log(calculateLandmarks());
}

/**
 * Construct the landmark list entirely from the bearing data
 */
function calculateLandmarks() {
	let firstLandmark = null;
	let secondLandmark = null;
	let firstLandmarks = {}; // use this to calculate the first two landmarks

	// construct initial data from measurements data

	Object.values(measurements).forEach(measurement => {
		landmarks[measurement.from] = landmarks[measurement.from] || {name: measurement.from};
		let fromLandmark = landmarks[measurement.from];
		fromLandmark.visited = true; // if you measured from this landmark then you were there!

		if (firstLandmark === null && firstLandmarks[measurement.from] !== undefined) {
			firstLandmark = landmarks[firstLandmarks[measurement.from].from];
			secondLandmark = fromLandmark;
		}

		if (measurement.to !== "") { // the destination has been named
			// initialise known targets array
			firstLandmarks[measurement.to] = measurement;

			fromLandmark.knownTargets = fromLandmark.knownTargets || {};

			// add the current record
			fromLandmark.knownTargets[measurement.to] = {
				name: measurement.to
				,bearing: measurement.bearing
			};

			landmarks[measurement.to] = landmarks[measurement.to] || {name: measurement.to};
		} else { // unnamed landmarks are just treated as bearings at this point
			fromLandmark.unknownTargets = fromLandmark.unknownTargets || [];
			fromLandmark.unknownTargets.push({"bearing": measurement.bearing});
		}

	});

	// start calculating landmark locations given the starting landmark
	if (firstLandmark) locateLandmark(firstLandmark, 0,0); // place the first landmark on origin immediately
	if (secondLandmark) {
		let bearing = firstLandmark.knownTargets[secondLandmark.name].bearing * Math.PI / 180;
		locateLandmark(
			secondLandmark, Math.sin(bearing)
			,Math.cos(bearing)
		); // create the second landmark 1 unit away at specified angle
	}
	render();

	return landmarks;
}

/**
 * Update chart axes to neatly contain the map
 */
function render() {
	// update chart boundaries
	const svgNamespace = "http://www.w3.org/2000/svg";
	
	let boundaries = {
		xMin: 0, xMax: 0, yMin: 0, yMax: 0
	};

	Object.values(landmarks).filter(landmark => landmark.located).forEach(landmark =>
		boundaries = {
			xMin: Math.min(boundaries.xMin, Math.round(landmark.x-1))
			,xMax: Math.max(boundaries.xMax, Math.round(landmark.x + 1))
			,yMin: Math.min(boundaries.yMin, Math.round(landmark.y -1))
			,yMax: Math.max(boundaries.yMax, Math.round(landmark.y + 1))
		}
	);

	Object.values(landmarks).forEach(landmark => {
//		$("#map")[0].innerHTML = "";
		
		if (landmark.located === true) {
			let landmarkSVG = document.createElementNS(svgNamespace, "circle");
			landmarkSVG.setAttribute("cx", landmark.x);
			landmarkSVG.setAttribute("cy", landmark.y);
			landmarkSVG.setAttribute("r", 0.3);
//			landmarkSVG.setAttribute("fill", "black");
			landmarkSVG.classList.add(landmark.visited === true ? 'visited' : 'unvisited');
			$("#map")[0].appendChild(landmarkSVG);
		}
	});
	
}

/***
 * A landmark has been located. Analyse it alongside the other located landmarks to try find more
 * @param {type} landmark the landmark that has been located
 * @param {type} x the X co-ordinate to record against the landmark
 * @param {type} y the Y co-ordinate to record against the landmark
 * @returns {undefined}
 */
function locateLandmark(landmark, x, y) {
	Object.assign(landmark, {x:x, y:y, located:true});
	let locatedQueue = [landmark];

	while (locatedQueue.length > 0) {
		let landmark = locatedQueue.shift();
		console.log(`${landmark.name} located @ [${landmark.x.toFixed(1)}, ${landmark.y.toFixed(1)}]`);

		Object.values(landmarks)
			.filter(
				locatedLandmark => locatedLandmark.name !== landmark.name // it is not the same landmark
				&& locatedLandmark.located === true // has been previously located
				&& inRange(landmark, locatedLandmark) // within appropriate comparison range
			)
			.forEach(locatedLandmark => locatedQueue.push(...compareLandmark(landmark, locatedLandmark)));
	}
}

/**
 * Compare two located landmarks
 */
function compareLandmark(landmark1, landmark2) {
	let locatedLandmarks = [];

	// compare known locations of both landmarks
	locatedLandmarks.push(...compareKnown(landmark1, landmark2));

	// compare landmark 1 known to landmark 2 unknown
	locatedLandmarks.push(...compareKnownUnknown(landmark1, landmark2));
	locatedLandmarks.push(...compareKnownUnknown(landmark2, landmark1)); // also need to do this in reverse

	return locatedLandmarks;
}

/**
 * Compare known locations for  two landmarks
 */
function compareKnown(landmark1, landmark2) {
	let locatedLandmarks = [];
	if (landmark1.knownTargets !== undefined && landmark2.knownTargets !== undefined) {
		Object.values(landmark1.knownTargets).forEach(knownTarget1 => {
			let locatedLandmark = null;
			Object.values(landmark2.knownTargets).filter(knownTarget2 => knownTarget2.name == knownTarget1.name).forEach(knownTarget2 => {
				if (locatedLandmark !== null) return; // no need to process since the target has been resolved
				let triangulation = triangulate(landmark1, knownTarget1.bearing, landmark2, knownTarget2.bearing);

				if (debug) {
					console.log(`Triangulating ${knownTarget1.name} from ${landmark1.name}(${knownTarget1.bearing}) and ${landmark2.name}(${knownTarget2.bearing})`);
					if (triangulation) {
						console.log(`Triangulated ${knownTarget1.name} x: ${triangulation.x}, y:${triangulation.y} from ${landmark1.name}(${knownTarget1.bearing}) and ${landmark2.name}(${knownTarget2.bearing})`);
					} else {
						console.log(`Unable to triangulate ${knownTarget1.name} from ${landmark1.name}(${knownTarget1.bearing}) and ${landmark2.name}(${knownTarget2.bearing})`);
					}
				}

				if (!landmarks[knownTarget1.name].located && inRange(landmark1, triangulation)) {
					let locatedLandmark = Object.assign(
						landmarks[knownTarget1.name]
						,triangulation
						,{located: true}
					);
					locatedLandmarks.push(locatedLandmark);
				}
			});
		});
	}
	return locatedLandmarks;
}

/**
 * Compare known targets for an landmark against unknown targets for the other landmark
 * @param {Object} knownLandmark landmark with known bearings
 * @param {Object} unknownLandmark landmark with unknown bearings
 * @returns {Array|compareKnownUnknown.locatedLandmarks}
 */
function compareKnownUnknown(knownLandmark, unknownLandmark) {
	let locatedLandmarks = [];
	if (knownLandmark.knownTargets !== undefined && unknownLandmark.unknownTargets !== undefined) {
		Object.values(knownLandmark.knownTargets).forEach(knownTarget1 => {
			let locatedLandmark = null;
			Object.values(unknownLandmark.unknownTargets).forEach((unknownTarget, index) => {
				if (locatedLandmark !== null) return; // no need to process since the target has been resolved
				let triangulation = triangulate(knownLandmark, knownTarget1.bearing ,unknownLandmark, unknownTarget.bearing);

				if (debug) {
					console.log(`Triangulating ${knownTarget1.name} from ${knownLandmark.name}(${knownTarget1.bearing}) and ${unknownLandmark.name}(${unknownTarget.bearing})`);
					if (triangulation) {
						console.log(`Triangulated ${knownTarget1.name} x: ${triangulation.x}, y:${triangulation.y} from ${knownLandmark.name}(${knownTarget1.bearing}) and ${unknownLandmark.name}(${unknownTarget.bearing})`);
					} else {
						console.log(`Unable to triangulate ${knownTarget1.name} from ${knownLandmark.name}(${knownTarget1.bearing}) and ${unknownLandmark.name}(${unknownTarget.bearing})`);
					}
				}

				if (!landmarks[knownTarget1.name].located && inRange(knownLandmark, triangulation)) {
					let locatedLandmark = Object.assign(landmarks[knownTarget1.name], triangulation, {located: true});
					locatedLandmarks.push(locatedLandmark);

					unknownLandmark.unknownTargets.splice(index, 1); // remove this entry from the unknown targets since it has been resolved
				}
			});
		});
	}
	return locatedLandmarks;
}

/**
 * Determine whether two landmarks co-ordinates are within an appropriate range
 */
function inRange(landmark1, landmark2) {
	if (
		!landmark1 || !landmark2 
		|| landmark1.x === null || landmark1.y === null || landmark2.x === null || landmark2.y === null
	) return false;
	let landmarkDistance = distance(landmark1.x, landmark1.y, landmark2.x, landmark2.y);
	return (landmarkDistance <= (maxDistanceMultiplier) && landmarkDistance > (0.2));
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
