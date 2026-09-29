# Material Symbols

`app/src/main/res/drawable/ic_mail.xml` comes from Google's Material Symbols:
https://github.com/google/material-design-icons/blob/master/symbols/android/mail/materialsymbolsoutlined/mail_24px.xml

Licensed under Apache 2.0; see material-design-icons-LICENSE. Modification: removed theme tint so the launcher foreground stays white. The adaptive icon adds SIMLink's blue background.

The native gateway UI also uses unmodified outlined Material Symbols paths for
home, settings, smartphone, dns, sim_card, verified_user, battery_full,
chevron_right, arrow_back, sync and info. Sources use the same official pattern:
`https://github.com/google/material-design-icons/blob/master/symbols/android/{name}/materialsymbolsoutlined/{name}_24px.xml`.
Theme tint is removed; GatewayStyle applies the shared semantic colors.
