# Regenerates the synthetic GRIB2 fixtures + synthetic-expected.json (eccodes decode = ground truth).
# python3 -m venv v && v/bin/pip install eccodes && v/bin/python make-synthetic.py test/fixtures/gfs-wind
import sys, json, math, eccodes
outdir = sys.argv[1]
Ni, Nj = 12, 7
def field(seed):
    return [round(10*math.sin(0.3*i*seed+0.7*j)+0.37*seed, 3) for j in range(Nj) for i in range(Ni)]
cases = [
  ('simple', 'grid_simple', None, 0),
  ('complex', 'grid_complex', None, 0),
  ('sd1', 'grid_complex_spatial_differencing', 1, 0),
  ('sd2', 'grid_complex_spatial_differencing', 2, 0),
  ('sd2_bitmap', 'grid_complex_spatial_differencing', 2, 1),
  ('simple_bitmap', 'grid_simple', None, 1),
]
expected = {}
for name, pk, order, bm in cases:
    h = eccodes.codes_grib_new_from_samples('regular_ll_sfc_grib2')
    for k, v in [('Ni', Ni), ('Nj', Nj), ('latitudeOfFirstGridPointInDegrees', 30.0), ('longitudeOfFirstGridPointInDegrees', 350.0),
                 ('latitudeOfLastGridPointInDegrees', 0.0), ('longitudeOfLastGridPointInDegrees', 23.0),
                 ('iDirectionIncrementInDegrees', 3.0), ('jDirectionIncrementInDegrees', 5.0)]:
        eccodes.codes_set(h, k, v)
    eccodes.codes_set(h, 'discipline', 0); eccodes.codes_set(h, 'parameterCategory', 2); eccodes.codes_set(h, 'parameterNumber', 2)
    eccodes.codes_set(h, 'typeOfFirstFixedSurface', 103); eccodes.codes_set(h, 'scaledValueOfFirstFixedSurface', 10); eccodes.codes_set(h, 'scaleFactorOfFirstFixedSurface', 0)
    eccodes.codes_set(h, 'dataDate', 20261021); eccodes.codes_set(h, 'dataTime', 1800)
    eccodes.codes_set(h, 'indicatorOfUnitOfTimeRange', 1); eccodes.codes_set(h, 'forecastTime', 9)
    vals = field(len(name))
    eccodes.codes_set(h, 'packingType', pk)
    if order: eccodes.codes_set(h, 'orderOfSpatialDifferencing', order)
    eccodes.codes_set(h, 'decimalScaleFactor', 2); eccodes.codes_set(h, 'bitsPerValue', 12)
    if bm:
        eccodes.codes_set(h, 'missingValue', 9999)
        eccodes.codes_set(h, 'bitmapPresent', 1)
        for i in (0, 5, 13, 40, 83): vals[i] = 9999
    eccodes.codes_set_values(h, vals)
    with open(f'{outdir}/synthetic-{name}.grb2', 'wb') as f: eccodes.codes_write(h, f)
    with open(f'{outdir}/synthetic-{name}.grb2', 'rb') as f:
        r = eccodes.codes_grib_new_from_file(f)
        got = eccodes.codes_get_values(r)
        miss = eccodes.codes_get(r, 'missingValue')
        expected[name] = {'template': eccodes.codes_get(r, 'dataRepresentationTemplateNumber'),
                          'order': eccodes.codes_get(r, 'orderOfSpatialDifferencing') if eccodes.codes_get(r, 'dataRepresentationTemplateNumber') == 3 else None,
                          'bitmap': eccodes.codes_get(r, 'bitmapPresent'),
                          'grid': [eccodes.codes_get(r, k) for k in ('Ni','Nj','latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','latitudeOfLastGridPointInDegrees','longitudeOfLastGridPointInDegrees','iDirectionIncrementInDegrees','jDirectionIncrementInDegrees')],
                          'refTime': f"{eccodes.codes_get(r,'dataDate')} {eccodes.codes_get(r,'dataTime')}", 'forecastTime': eccodes.codes_get(r,'forecastTime'),
                          'values': [None if x == miss else float(x) for x in got]}
        eccodes.codes_release(r)
    eccodes.codes_release(h)
json.dump(expected, open(f'{outdir}/synthetic-expected.json', 'w'))
for k, v in expected.items(): print(k, v['template'], v['order'], v['bitmap'], v['grid'], v['refTime'], v['forecastTime'], v['values'][:4], sum(x is None for x in v['values']))
