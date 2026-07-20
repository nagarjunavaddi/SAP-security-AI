METHOD userlockset_get_entityset.
  DATA: lt_usr02   TYPE STANDARD TABLE OF usr02,
        ls_usr02   TYPE usr02,
        ls_entity  LIKE LINE OF et_entityset.

  SELECT * FROM usr02 INTO TABLE lt_usr02 ORDER BY bname.

  LOOP AT lt_usr02 INTO ls_usr02.
    CLEAR ls_entity.
    ls_entity-username = ls_usr02-bname.
    ls_entity-fullname = ls_usr02-bname.

    IF ls_usr02-uflag = 0.
      ls_entity-lockstatus = 'Unlocked'.
    ELSE.
      ls_entity-lockstatus = 'Locked'.
    ENDIF.

    ls_entity-usertype = ls_usr02-ustyp.
    APPEND ls_entity TO et_entityset.
  ENDLOOP.
ENDMETHOD.
