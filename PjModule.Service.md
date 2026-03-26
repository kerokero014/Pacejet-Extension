## PAYLOAD

```JSON
{
"shipmethod": "1358",
"pacejetAmount": 244.92,
"carrier": "UPS",
"service": "UPS Ground",
"transitDays": "3",
"quoteJson": "{\"shipmethod\":\"1358\",\"amount\":244.92,\"carrier\":\"UPS\",\"service\":\"UPS Ground\",\"transitDays\":\"3\",\"origins\":[{\"originKey\":\"FACILITY|MAIN|62\",\"dropShip\":false,\"state\":\"UT\",\"city\":\"Springville\",\"postal\":\"84663\",\"country\":\"US\",\"carrier\":\"UPS\",\"service\":\"UPS Ground\",\"cost\":176.2,\"raw\":{\"carrierNumber\":\"UPS\",\"carrierClassOfServiceCode\":\"Ground\",\"carrierClassOfServiceCodeDescription\":\"UPS Ground\",\"shipMode\":\"Parcel\",\"rateSystem\":\"Parcel\",\"statusMessage\":\"\",\"consignorFreight\":176.2,\"consigneeFreight\":244.918,\"listFreight\":337.66,\"totalServiceFees\":112.5,\"fuelSurcharge\":0,\"currencyCode\":\"USD\",\"arrivalDateText\":\"MON - 3/30/2026 11:00:00 PM\",\"transitTime\":3,\"shipCodeXRef\":\"1358\",\"exclude\":false,\"scac\":null}}]}",
"customfields": [
{
"id": "custbody_none_additional_fees_may_app",
"value": "T"
}
]
}
```

RESPONSE:
{
"errorStatusCode": "500",
"errorCode": "UNEXPECTED_ERROR",
"errorMessage": "TypeError: Cannot read property &quot;length&quot; from undefined (ssp_libraries.js#12423)"
}
