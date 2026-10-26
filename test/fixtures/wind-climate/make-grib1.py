# Regenerates the synthetic GRIB1 fixture + grib1-expected.json (eccodes decode = ground truth).
# python3 -m venv v && v/bin/pip install eccodes && v/bin/python make-grib1.py test/fixtures/wind-climate
import sys, json, math, eccodes
outdir = sys.argv[1]
Ni, Nj = 12, 7
def field(seed):
    return [round(9*math.sin(0.3*i*seed+0.7*j)-2.5+0.37*seed, 3) for j in range(Nj) for i in range(Ni)]
# name, ERA5 param (table 128), scan mode, bitmap, constant
cases = [('u', 165, 0, False, False), ('v', 166, 64, False, False), ('si', 207, 0, True, False), ('const', 165, 0, False, True)]
expected = []
with open(f'{outdir}/synthetic.grib1', 'wb') as out:
    for name, param, scan, bitmap, const in cases:
        h = eccodes.codes_grib_new_from_samples('regular_ll_sfc_grib1')
        eccodes.codes_set(h, 'centre', 98); eccodes.codes_set(h, 'table2Version', 128)
        eccodes.codes_set(h, 'indicatorOfParameter', param)
        eccodes.codes_set(h, 'Ni', Ni); eccodes.codes_set(h, 'Nj', Nj)
        eccodes.codes_set(h, 'jScansPositively', 1 if scan == 64 else 0)
        north, south = 30.0, 0.0
        eccodes.codes_set(h, 'latitudeOfFirstGridPointInDegrees', south if scan == 64 else north)
        eccodes.codes_set(h, 'latitudeOfLastGridPointInDegrees', north if scan == 64 else south)
        eccodes.codes_set(h, 'longitudeOfFirstGridPointInDegrees', 350.0)
        eccodes.codes_set(h, 'longitudeOfLastGridPointInDegrees', 23.0)
        eccodes.codes_set(h, 'iDirectionIncrementInDegrees', 3.0); eccodes.codes_set(h, 'jDirectionIncrementInDegrees', 5.0)
        eccodes.codes_set(h, 'dataDate', 20240701); eccodes.codes_set(h, 'dataTime', 0)
        eccodes.codes_set(h, 'decimalScaleFactor', 1); eccodes.codes_set(h, 'bitsPerValue', 12)
        vals = [4.2] * (Ni * Nj) if const else field(len(name) + param % 7)
        if bitmap:
            eccodes.codes_set(h, 'bitmapPresent', 1); eccodes.codes_set(h, 'missingValue', 9999)
            vals = [9999 if (k % 5 == 2) else x for k, x in enumerate(vals)]
        eccodes.codes_set_values(h, vals)
        got = eccodes.codes_get_values(h)
        expected.append({'name': name, 'param': param, 'scanMode': scan, 'nx': Ni, 'ny': Nj,
                         'la1': eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees'),
                         'lo1': eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees'),
                         'values': [None if (bitmap and x == 9999) else round(float(x), 6) for x in got]})
        out.write(eccodes.codes_get_message(h))
        eccodes.codes_release(h)
json.dump(expected, open(f'{outdir}/grib1-expected.json', 'w'))
print('cases', len(expected))
