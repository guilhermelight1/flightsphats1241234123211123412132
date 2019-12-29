var canvas = d3.select("canvas");
var ctx = canvas.node().getContext("2d");
var canvasWidth = +canvas.attr("width");
var canvasHeight = +canvas.attr("height");

var projection = d3
  .geoOrthographic()
  .rotate([-161.03795250984288, -78.66662854125848, 180])
  .fitSize([canvasWidth, canvasHeight], { type: "Sphere" });

var geoPathGenerator = d3
  .geoPath()
  .projection(projection)
  .context(ctx);

ctx.lineJoin = "round";
ctx.lineCap = "round";
ctx.fillStyle = "white";

var sphereStyle = {
  lineWidth: 1,
  strokeStyle: "white"
};

var countriesStyle = {
  lineWidth: 0.5,
  strokeStyle: "#1d2224"
};

var allFlightLinesStyle = {
  lineWidth: 2,
  strokeStyle: "rgba(0, 191, 255, 0.75)"
};

var activeFlightLineStyle = {
  lineWidth: 5,
  strokeStyle: "deeppink"
};

// draw sphere while waiting for world topojson to load and parse
drawEarth(true, false);

d3
  .json("https://unpkg.com/world-atlas@1.1.4/world/110m.json")
  .then(function(loadedTopoJson) {
    var topology = topojson.presimplify(loadedTopoJson);
    topology = topojson.simplify(topology, 0.25);
    var worldGeoJson = topojson.feature(topology, topology.objects.countries);

    // draw countries
    drawEarth(false, worldGeoJson);

    Promise.all([
      d3.csv(
        "https://gist.githubusercontent.com/jwasilgeo/df731e6bec2ce12ceb2b0bc2274c5ee9/raw/5b22f98b114d1624893a0f370bb63ad81fc13b5c/longest_flights_10242018.csv"
      ),
      d3.json(
        "https://gist.githubusercontent.com/jwasilgeo/df731e6bec2ce12ceb2b0bc2274c5ee9/raw/5b22f98b114d1624893a0f370bb63ad81fc13b5c/airports.topojson.json"
      )
    ]).then(function(loadedDataResults) {
      var csvData = loadedDataResults[0];

      var airportsGeoJson = topojson.feature(
        loadedDataResults[1],
        loadedDataResults[1].objects.collection
      );

      var lineStringGeometryInfos = csvData.map(function(csvRow) {
        // look up from and to coordinates by matching csv row with airports geojson file
        var fromCoordinates = airportsGeoJson.features.filter(function(f) {
          return f.properties.name === csvRow.From;
        })[0].geometry.coordinates;

        var toCoordinates = airportsGeoJson.features.filter(function(f) {
          return f.properties.name === csvRow.To;
        })[0].geometry.coordinates;

        var lineStringGeometry = {
          type: "LineString",
          coordinates: [fromCoordinates, toCoordinates]
        };

        // use geodesy.js to help with bearing calculations
        var fromLatLon = new LatLon(fromCoordinates[1], fromCoordinates[0]);
        var toLatLon = new LatLon(toCoordinates[1], toCoordinates[0]);
        var midLatLon = fromLatLon.midpointTo(toLatLon);

        return {
          lineStringGeometry: lineStringGeometry,
          centroid: d3.geoCentroid(lineStringGeometry),
          bearing: midLatLon.bearingTo(toLatLon),
          fromCoordinates: fromCoordinates,
          toCoordinates: toCoordinates,
          fromAirportName: csvRow.From,
          toAirportName: csvRow.To,
          rank: csvRow.Rank,
          distance: csvRow.Distance
        };
      });

      drawInitialFlightLines(worldGeoJson, lineStringGeometryInfos);
    });
  });

function drawInitialFlightLines(worldGeoJson, lineStringGeometryInfos) {
  d3
    .select({})
    .transition()
    .duration(5000)
    .tween(null, function() {
      return function(t) {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        drawEarth(true, worldGeoJson);

        // progressively draw partial flight lines during each step of the transition
        ctx.lineWidth = allFlightLinesStyle.lineWidth;
        ctx.strokeStyle = allFlightLinesStyle.strokeStyle;
        lineStringGeometryInfos.forEach(function(geometryInfo) {
          var partialLine = JSON.parse(
            JSON.stringify(geometryInfo.lineStringGeometry)
          );
          var interpolatedEndPoint = d3.geoInterpolate(
            partialLine.coordinates[0],
            partialLine.coordinates[1]
          )(t);
          partialLine.coordinates[1] = interpolatedEndPoint;
          ctx.beginPath();
          geoPathGenerator(partialLine);
          ctx.stroke();
          ctx.closePath();
        });
      };
    })
    .on("end", function() {
      rotateMapToNextFeature(worldGeoJson, lineStringGeometryInfos);
    });
}

function rotateMapToNextFeature(worldGeoJson, lineStringGeometryInfos, delay) {
  var geometryInfo = lineStringGeometryInfos[0];
  var nextGeoJson = geometryInfo.lineStringGeometry;
  var nextCentroid = geometryInfo.centroid;
  var nextBearing = geometryInfo.bearing - 90;

  var nextRotationDestination = [
    -nextCentroid[0],
    -nextCentroid[1],
    nextBearing
  ];

  if (projection.rotate()[0] - nextRotationDestination[0] > 179) {
    nextRotationDestination[0] += 360;
  } else if (projection.rotate()[0] - nextRotationDestination[0] < -179) {
    nextRotationDestination[0] -= 360;
  }

  d3
    .select({})
    .transition()
    .duration(2000)
    .delay(delay ? delay : 0)
    .tween(null, function() {
      var interpolator = d3.interpolate(
        geoPathGenerator.projection().rotate(),
        nextRotationDestination
      );

      d3.select("#routeInfo").text(null);

      return function(t) {
        geoPathGenerator.projection().rotate(interpolator(t));

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        drawEarth(true, worldGeoJson);

        // draw all flight lines
        ctx.lineWidth = allFlightLinesStyle.lineWidth;
        ctx.strokeStyle = allFlightLinesStyle.strokeStyle;
        lineStringGeometryInfos.forEach(function(geometryInfo) {
          ctx.beginPath();
          geoPathGenerator(geometryInfo.lineStringGeometry);
          ctx.stroke();
          ctx.closePath();
        });
      };
    })
    .on("end", function() {
      animateActiveFlightLine(
        worldGeoJson,
        lineStringGeometryInfos,
        function() {
          lineStringGeometryInfos.push(lineStringGeometryInfos.shift());
          rotateMapToNextFeature(worldGeoJson, lineStringGeometryInfos, 1750);
        }
      );
    });
}

function animateActiveFlightLine(
  worldGeoJson,
  lineStringGeometryInfos,
  callback
) {
  var geometryInfo = lineStringGeometryInfos[0];
  var nextGeoJson = geometryInfo.lineStringGeometry;

  d3
    .select("#routeInfo")
    .html(
      "<p>" +
      geometryInfo.rank +
      ". " +
      geometryInfo.fromAirportName +
      " to " +
      geometryInfo.toAirportName +
      "</p><p>" +
      geometryInfo.distance +
      "</p>"
    );

  d3
    .select({})
    .transition()
    .duration(6000)
    .tween(null, function() {
      return function(t) {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        drawEarth(true, worldGeoJson);

        // draw all flight lines
        ctx.lineWidth = allFlightLinesStyle.lineWidth;
        ctx.strokeStyle = allFlightLinesStyle.strokeStyle;
        lineStringGeometryInfos.forEach(function(geometryInfo) {
          ctx.beginPath();
          geoPathGenerator(geometryInfo.lineStringGeometry);
          ctx.stroke();
          ctx.closePath();
        });

        // progressively draw active flight line
        ctx.lineWidth = activeFlightLineStyle.lineWidth;
        ctx.strokeStyle = activeFlightLineStyle.strokeStyle;
        var partialLine = JSON.parse(JSON.stringify(nextGeoJson));
        var interpolatedEndPoint = d3.geoInterpolate(
          partialLine.coordinates[0],
          partialLine.coordinates[1]
        )(t);
        partialLine.coordinates[1] = interpolatedEndPoint;
        ctx.beginPath();
        geoPathGenerator(partialLine);
        ctx.stroke();
        ctx.closePath();
      };
    })
    .on("end", callback);
}

function drawEarth(drawSphere, worldGeoJson) {
  if (drawSphere) {
    // draw sphere
    ctx.lineWidth = sphereStyle.lineWidth;
    ctx.strokeStyle = sphereStyle.strokeStyle;
    ctx.beginPath();
    geoPathGenerator({ type: "Sphere" });
    ctx.stroke();
    ctx.closePath();
  }

  if (worldGeoJson) {
    // draw countries
    ctx.lineWidth = countriesStyle.lineWidth;
    ctx.strokeStyle = countriesStyle.strokeStyle;
    ctx.beginPath();
    geoPathGenerator(worldGeoJson);
    ctx.fill();
    ctx.stroke();
    ctx.closePath();
  }
}

// for some flat-earth fun you can try: toggleProjection('geoMercator');
function toggleProjection(projectionName) {
  projection = d3[projectionName]().fitSize([canvasWidth, canvasHeight], {
    type: "Sphere"
  });

  geoPathGenerator = d3
    .geoPath()
    .projection(projection)
    .context(ctx);
}